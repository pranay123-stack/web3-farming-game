// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "./FarmToken.sol";

/**
 * @title Marketplace
 * @dev NFT marketplace for trading game items using FGOLD tokens
 * Supports listing, buying, and canceling NFT sales
 */
contract Marketplace is Ownable, ReentrancyGuard, ERC721Holder {
    // The FGOLD token used for payments
    FarmToken public farmToken;

    // Listing struct
    struct Listing {
        address seller;         // Address of the seller
        address nftContract;    // Address of the NFT contract
        uint256 tokenId;        // Token ID of the NFT
        uint256 price;          // Price in FGOLD tokens
        uint256 listedAt;       // Timestamp when listed
        bool isActive;          // Whether the listing is active
    }

    // Mapping from listing ID to Listing data
    mapping(uint256 => Listing) public listings;

    // Listing ID counter
    uint256 public listingIdCounter;

    // Mapping from NFT contract => token ID => listing ID
    mapping(address => mapping(uint256 => uint256)) public nftToListingId;

    // Mapping from seller address to their listing IDs
    mapping(address => uint256[]) public sellerListings;

    // Marketplace fee (in basis points, e.g., 250 = 2.5%)
    uint256 public marketplaceFee;
    uint256 public constant MAX_FEE = 1000; // 10% max fee
    uint256 public constant FEE_DENOMINATOR = 10000;

    // Accumulated fees
    uint256 public accumulatedFees;

    // Whitelisted NFT contracts that can be traded
    mapping(address => bool) public whitelistedNFTs;

    // Events
    event ItemListed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );
    event ItemSold(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        address nftContract,
        uint256 tokenId,
        uint256 price,
        uint256 fee
    );
    event ListingCanceled(
        uint256 indexed listingId,
        address indexed seller,
        address nftContract,
        uint256 tokenId
    );
    event ListingPriceUpdated(
        uint256 indexed listingId,
        uint256 oldPrice,
        uint256 newPrice
    );
    event NFTWhitelisted(address indexed nftContract, bool status);
    event MarketplaceFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    /**
     * @dev Constructor initializes the marketplace
     * @param initialOwner The address that will own the contract
     * @param _farmToken Address of the FarmToken contract
     * @param _marketplaceFee Initial marketplace fee in basis points
     */
    constructor(
        address initialOwner,
        address _farmToken,
        uint256 _marketplaceFee
    ) Ownable(initialOwner) {
        require(_farmToken != address(0), "Marketplace: invalid token address");
        require(_marketplaceFee <= MAX_FEE, "Marketplace: fee too high");

        farmToken = FarmToken(_farmToken);
        marketplaceFee = _marketplaceFee;
    }

    /**
     * @dev Whitelists or removes an NFT contract from trading
     * @param nftContract The NFT contract address
     * @param status Whether to whitelist (true) or remove (false)
     */
    function setNFTWhitelist(address nftContract, bool status) external onlyOwner {
        require(nftContract != address(0), "Marketplace: invalid NFT address");
        whitelistedNFTs[nftContract] = status;
        emit NFTWhitelisted(nftContract, status);
    }

    /**
     * @dev Updates the marketplace fee
     * @param newFee The new fee in basis points
     */
    function setMarketplaceFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE, "Marketplace: fee too high");
        uint256 oldFee = marketplaceFee;
        marketplaceFee = newFee;
        emit MarketplaceFeeUpdated(oldFee, newFee);
    }

    /**
     * @dev Lists an NFT for sale
     * @param nftContract The NFT contract address
     * @param tokenId The token ID to list
     * @param price The price in FGOLD tokens
     * @return listingId The ID of the new listing
     */
    function listItem(
        address nftContract,
        uint256 tokenId,
        uint256 price
    ) external nonReentrant returns (uint256) {
        require(whitelistedNFTs[nftContract], "Marketplace: NFT not whitelisted");
        require(price > 0, "Marketplace: price must be greater than 0");

        IERC721 nft = IERC721(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Marketplace: not token owner");
        require(
            nft.isApprovedForAll(msg.sender, address(this)) ||
            nft.getApproved(tokenId) == address(this),
            "Marketplace: not approved"
        );

        // Check if already listed
        uint256 existingListingId = nftToListingId[nftContract][tokenId];
        if (existingListingId != 0 && listings[existingListingId].isActive) {
            revert("Marketplace: already listed");
        }

        // Transfer NFT to marketplace
        nft.safeTransferFrom(msg.sender, address(this), tokenId);

        // Create listing
        uint256 listingId = ++listingIdCounter;

        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            listedAt: block.timestamp,
            isActive: true
        });

        nftToListingId[nftContract][tokenId] = listingId;
        sellerListings[msg.sender].push(listingId);

        emit ItemListed(listingId, msg.sender, nftContract, tokenId, price);

        return listingId;
    }

    /**
     * @dev Buys a listed NFT
     * @param listingId The ID of the listing
     */
    function buyItem(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.isActive, "Marketplace: listing not active");
        require(msg.sender != listing.seller, "Marketplace: cannot buy own item");

        uint256 price = listing.price;
        address seller = listing.seller;
        address nftContract = listing.nftContract;
        uint256 tokenId = listing.tokenId;

        // Calculate fee
        uint256 fee = (price * marketplaceFee) / FEE_DENOMINATOR;
        uint256 sellerProceeds = price - fee;

        // Mark listing as inactive
        listing.isActive = false;
        delete nftToListingId[nftContract][tokenId];

        // Transfer FGOLD from buyer to seller
        farmToken.transferFrom(msg.sender, seller, sellerProceeds);

        // Transfer fee to marketplace
        if (fee > 0) {
            farmToken.transferFrom(msg.sender, address(this), fee);
            accumulatedFees += fee;
        }

        // Transfer NFT to buyer
        IERC721(nftContract).safeTransferFrom(address(this), msg.sender, tokenId);

        emit ItemSold(listingId, seller, msg.sender, nftContract, tokenId, price, fee);
    }

    /**
     * @dev Cancels a listing and returns the NFT to the seller
     * @param listingId The ID of the listing to cancel
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.isActive, "Marketplace: listing not active");
        require(
            msg.sender == listing.seller || msg.sender == owner(),
            "Marketplace: not seller or owner"
        );

        address nftContract = listing.nftContract;
        uint256 tokenId = listing.tokenId;
        address seller = listing.seller;

        // Mark listing as inactive
        listing.isActive = false;
        delete nftToListingId[nftContract][tokenId];

        // Return NFT to seller
        IERC721(nftContract).safeTransferFrom(address(this), seller, tokenId);

        emit ListingCanceled(listingId, seller, nftContract, tokenId);
    }

    /**
     * @dev Updates the price of a listing
     * @param listingId The ID of the listing
     * @param newPrice The new price in FGOLD tokens
     */
    function updateListingPrice(uint256 listingId, uint256 newPrice) external {
        Listing storage listing = listings[listingId];
        require(listing.isActive, "Marketplace: listing not active");
        require(msg.sender == listing.seller, "Marketplace: not seller");
        require(newPrice > 0, "Marketplace: price must be greater than 0");

        uint256 oldPrice = listing.price;
        listing.price = newPrice;

        emit ListingPriceUpdated(listingId, oldPrice, newPrice);
    }

    /**
     * @dev Gets a listing by ID
     * @param listingId The ID of the listing
     * @return The Listing struct
     */
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    /**
     * @dev Gets all active listings
     * @param offset Starting index
     * @param limit Maximum number of listings to return
     * @return An array of active listings and their IDs
     */
    function getActiveListings(
        uint256 offset,
        uint256 limit
    ) external view returns (Listing[] memory, uint256[] memory) {
        // Count active listings
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= listingIdCounter; i++) {
            if (listings[i].isActive) {
                activeCount++;
            }
        }

        // Calculate actual size to return
        uint256 startIndex = offset;
        uint256 size = limit;
        if (startIndex >= activeCount) {
            return (new Listing[](0), new uint256[](0));
        }
        if (startIndex + size > activeCount) {
            size = activeCount - startIndex;
        }

        Listing[] memory result = new Listing[](size);
        uint256[] memory ids = new uint256[](size);
        uint256 resultIndex = 0;
        uint256 skipped = 0;

        for (uint256 i = 1; i <= listingIdCounter && resultIndex < size; i++) {
            if (listings[i].isActive) {
                if (skipped < offset) {
                    skipped++;
                } else {
                    result[resultIndex] = listings[i];
                    ids[resultIndex] = i;
                    resultIndex++;
                }
            }
        }

        return (result, ids);
    }

    /**
     * @dev Gets all listings for a specific NFT contract
     * @param nftContract The NFT contract address
     * @return An array of listings and their IDs
     */
    function getListingsByNFT(
        address nftContract
    ) external view returns (Listing[] memory, uint256[] memory) {
        // Count listings for this NFT contract
        uint256 count = 0;
        for (uint256 i = 1; i <= listingIdCounter; i++) {
            if (listings[i].isActive && listings[i].nftContract == nftContract) {
                count++;
            }
        }

        Listing[] memory result = new Listing[](count);
        uint256[] memory ids = new uint256[](count);
        uint256 index = 0;

        for (uint256 i = 1; i <= listingIdCounter && index < count; i++) {
            if (listings[i].isActive && listings[i].nftContract == nftContract) {
                result[index] = listings[i];
                ids[index] = i;
                index++;
            }
        }

        return (result, ids);
    }

    /**
     * @dev Gets all listings by a seller
     * @param seller The seller's address
     * @return An array of listings and their IDs
     */
    function getListingsBySeller(
        address seller
    ) external view returns (Listing[] memory, uint256[] memory) {
        uint256[] storage listingIds = sellerListings[seller];

        // Count active listings
        uint256 activeCount = 0;
        for (uint256 i = 0; i < listingIds.length; i++) {
            if (listings[listingIds[i]].isActive) {
                activeCount++;
            }
        }

        Listing[] memory result = new Listing[](activeCount);
        uint256[] memory ids = new uint256[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < listingIds.length && index < activeCount; i++) {
            if (listings[listingIds[i]].isActive) {
                result[index] = listings[listingIds[i]];
                ids[index] = listingIds[i];
                index++;
            }
        }

        return (result, ids);
    }

    /**
     * @dev Gets the listing ID for a specific NFT
     * @param nftContract The NFT contract address
     * @param tokenId The token ID
     * @return The listing ID (0 if not listed)
     */
    function getListingIdForNFT(
        address nftContract,
        uint256 tokenId
    ) external view returns (uint256) {
        return nftToListingId[nftContract][tokenId];
    }

    /**
     * @dev Withdraws accumulated marketplace fees
     * @param recipient The address to receive the fees
     */
    function withdrawFees(address recipient) external onlyOwner {
        require(recipient != address(0), "Marketplace: invalid recipient");
        require(accumulatedFees > 0, "Marketplace: no fees to withdraw");

        uint256 amount = accumulatedFees;
        accumulatedFees = 0;

        farmToken.transfer(recipient, amount);

        emit FeesWithdrawn(recipient, amount);
    }

    /**
     * @dev Emergency function to rescue stuck NFTs
     * @param nftContract The NFT contract address
     * @param tokenId The token ID
     * @param recipient The address to receive the NFT
     */
    function rescueNFT(
        address nftContract,
        uint256 tokenId,
        address recipient
    ) external onlyOwner {
        require(recipient != address(0), "Marketplace: invalid recipient");

        // Check if there's an active listing
        uint256 listingId = nftToListingId[nftContract][tokenId];
        if (listingId != 0 && listings[listingId].isActive) {
            listings[listingId].isActive = false;
            delete nftToListingId[nftContract][tokenId];
        }

        IERC721(nftContract).safeTransferFrom(address(this), recipient, tokenId);
    }

    /**
     * @dev Updates the FarmToken contract address
     * @param _farmToken The new FarmToken address
     */
    function updateFarmToken(address _farmToken) external onlyOwner {
        require(_farmToken != address(0), "Marketplace: invalid token address");
        farmToken = FarmToken(_farmToken);
    }
}
