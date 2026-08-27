// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Marketplace
 * @notice Escrowed peer-to-peer NFT trading settled in FGOLD.
 *
 * @dev Front-running
 * ---------------
 * {buyItem} takes a `maxPrice`. Without it a seller could watch the mempool
 * and raise the price via {updateListingPrice} so the buyer's already-signed
 * transaction pays more than they agreed to. That was live in the previous
 * version. Two defences are in place now:
 *
 *   1. The buyer states the most they will pay; the trade reverts otherwise.
 *   2. A price increase resets `priceValidFrom`, and {buyItem} rejects
 *      listings repriced in the current block, closing the same-block
 *      reprice-then-fill window.
 *
 * @dev Escrow safety
 * ----------------
 * {rescueNFT} can no longer touch a token backing an active listing. It
 * previously cancelled the listing and sent the NFT anywhere the owner chose,
 * which let the operator seize any escrowed item. Recovery of genuinely stuck
 * tokens (sent here by mistake, never listed) still works.
 */
contract Marketplace is Ownable2Step, ReentrancyGuard, Pausable, ERC721Holder {
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        uint256 listedAt;
        uint256 priceValidFrom; // block after which the current price may be filled
        bool isActive;
    }

    IERC20 public immutable farmToken;

    mapping(uint256 => Listing) public listings;
    uint256 public listingIdCounter; // ids start at 1; 0 means "not listed"

    mapping(address => mapping(uint256 => uint256)) public nftToListingId;
    mapping(address => uint256[]) private _sellerListings;

    /// @dev Dense array of active listing ids, with an index side-table for
    ///      O(1) removal. Enumeration used to rescan every id ever created,
    ///      which turns into an RPC timeout long before it turns into a bug.
    uint256[] private _activeListingIds;
    mapping(uint256 => uint256) private _activeListingIndex; // listingId => index+1

    uint256 public marketplaceFee; // basis points
    uint256 public constant MAX_FEE = 1000; // 10%
    uint256 public constant FEE_DENOMINATOR = 10000;

    uint256 public accumulatedFees;
    mapping(address => bool) public whitelistedNFTs;

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
    event ListingCanceled(uint256 indexed listingId, address indexed seller, address nftContract, uint256 tokenId);
    event ListingPriceUpdated(uint256 indexed listingId, uint256 oldPrice, uint256 newPrice);
    event NFTWhitelisted(address indexed nftContract, bool status);
    event MarketplaceFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    event NFTRescued(address indexed nftContract, uint256 tokenId, address indexed recipient);

    error ZeroAddress();
    error FeeTooHigh(uint256 requested, uint256 maximum);
    error NotWhitelisted(address nftContract);
    error PriceMustBePositive();
    error NotTokenOwner(uint256 tokenId, address caller);
    error NotApproved(address nftContract, uint256 tokenId);
    error AlreadyListed(address nftContract, uint256 tokenId);
    error ListingNotActive(uint256 listingId);
    error CannotBuyOwnItem(uint256 listingId);
    error PriceExceedsMaximum(uint256 price, uint256 maxPrice);
    error PriceJustChanged(uint256 listingId);
    error NotSeller(uint256 listingId, address caller);
    error NoFeesToWithdraw();
    error TokenIsListed(address nftContract, uint256 tokenId);

    constructor(
        address initialOwner,
        address _farmToken,
        uint256 _marketplaceFee
    ) Ownable(initialOwner) {
        if (initialOwner == address(0) || _farmToken == address(0)) revert ZeroAddress();
        if (_marketplaceFee > MAX_FEE) revert FeeTooHigh(_marketplaceFee, MAX_FEE);
        // Immutable: swapping the settlement token under live listings would
        // let sellers be paid in something they never agreed to accept.
        farmToken = IERC20(_farmToken);
        marketplaceFee = _marketplaceFee;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setNFTWhitelist(address nftContract, bool status) external onlyOwner {
        if (nftContract == address(0)) revert ZeroAddress();
        whitelistedNFTs[nftContract] = status;
        emit NFTWhitelisted(nftContract, status);
    }

    function setMarketplaceFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_FEE) revert FeeTooHigh(newFee, MAX_FEE);
        uint256 oldFee = marketplaceFee;
        marketplaceFee = newFee;
        emit MarketplaceFeeUpdated(oldFee, newFee);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------
    // Trading
    // ------------------------------------------------------------------

    /// @notice Escrows `tokenId` and lists it for `price` FGOLD.
    function listItem(
        address nftContract,
        uint256 tokenId,
        uint256 price
    ) external nonReentrant whenNotPaused returns (uint256 listingId) {
        if (!whitelistedNFTs[nftContract]) revert NotWhitelisted(nftContract);
        if (price == 0) revert PriceMustBePositive();

        IERC721 nft = IERC721(nftContract);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (
            !nft.isApprovedForAll(msg.sender, address(this)) &&
            nft.getApproved(tokenId) != address(this)
        ) revert NotApproved(nftContract, tokenId);

        uint256 existing = nftToListingId[nftContract][tokenId];
        if (existing != 0 && listings[existing].isActive) revert AlreadyListed(nftContract, tokenId);

        listingId = ++listingIdCounter;
        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            listedAt: block.timestamp,
            priceValidFrom: block.number,
            isActive: true
        });

        nftToListingId[nftContract][tokenId] = listingId;
        _sellerListings[msg.sender].push(listingId);
        _addActiveListing(listingId);

        nft.safeTransferFrom(msg.sender, address(this), tokenId);

        emit ItemListed(listingId, msg.sender, nftContract, tokenId, price);
    }

    /**
     * @notice Buys a listing.
     * @param maxPrice The most the buyer is willing to pay. Reverts if the
     *        listing costs more, so a mempool reprice cannot overcharge them.
     */
    function buyItem(uint256 listingId, uint256 maxPrice) external nonReentrant whenNotPaused {
        Listing storage listing = listings[listingId];
        if (!listing.isActive) revert ListingNotActive(listingId);
        if (msg.sender == listing.seller) revert CannotBuyOwnItem(listingId);

        uint256 price = listing.price;
        if (price > maxPrice) revert PriceExceedsMaximum(price, maxPrice);
        // Reject a fill in the same block a price rise landed in.
        if (listing.priceValidFrom > block.number) revert PriceJustChanged(listingId);

        address seller = listing.seller;
        address nftContract = listing.nftContract;
        uint256 tokenId = listing.tokenId;

        uint256 fee = (price * marketplaceFee) / FEE_DENOMINATOR;
        uint256 sellerProceeds = price - fee;

        // Effects first.
        listing.isActive = false;
        delete nftToListingId[nftContract][tokenId];
        _removeActiveListing(listingId);
        if (fee > 0) {
            accumulatedFees += fee;
        }

        // Interactions.
        farmToken.safeTransferFrom(msg.sender, seller, sellerProceeds);
        if (fee > 0) {
            farmToken.safeTransferFrom(msg.sender, address(this), fee);
        }
        IERC721(nftContract).safeTransferFrom(address(this), msg.sender, tokenId);

        emit ItemSold(listingId, seller, msg.sender, nftContract, tokenId, price, fee);
    }

    /// @notice Cancels a listing and returns the escrowed NFT to its seller.
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.isActive) revert ListingNotActive(listingId);
        // Only the seller. The owner previously had this power too, which is
        // an unnecessary lever over other people's trades.
        if (msg.sender != listing.seller) revert NotSeller(listingId, msg.sender);

        address nftContract = listing.nftContract;
        uint256 tokenId = listing.tokenId;
        address seller = listing.seller;

        listing.isActive = false;
        delete nftToListingId[nftContract][tokenId];
        _removeActiveListing(listingId);

        IERC721(nftContract).safeTransferFrom(address(this), seller, tokenId);

        emit ListingCanceled(listingId, seller, nftContract, tokenId);
    }

    /**
     * @notice Changes a listing's price.
     * @dev A price *increase* defers `priceValidFrom` to the next block so it
     *      cannot be sprung on a pending buy. Lowering the price takes effect
     *      immediately - it can only ever help the buyer.
     */
    function updateListingPrice(uint256 listingId, uint256 newPrice) external whenNotPaused {
        Listing storage listing = listings[listingId];
        if (!listing.isActive) revert ListingNotActive(listingId);
        if (msg.sender != listing.seller) revert NotSeller(listingId, msg.sender);
        if (newPrice == 0) revert PriceMustBePositive();

        uint256 oldPrice = listing.price;
        listing.price = newPrice;
        if (newPrice > oldPrice) {
            listing.priceValidFrom = block.number + 1;
        }

        emit ListingPriceUpdated(listingId, oldPrice, newPrice);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function activeListingCount() external view returns (uint256) {
        return _activeListingIds.length;
    }

    /// @notice Page through active listings. O(limit), not O(all listings ever).
    function getActiveListings(
        uint256 offset,
        uint256 limit
    ) external view returns (Listing[] memory result, uint256[] memory ids) {
        uint256 total = _activeListingIds.length;
        if (offset >= total) {
            return (new Listing[](0), new uint256[](0));
        }
        uint256 size = total - offset;
        if (size > limit) size = limit;

        result = new Listing[](size);
        ids = new uint256[](size);
        for (uint256 i = 0; i < size; i++) {
            uint256 listingId = _activeListingIds[offset + i];
            ids[i] = listingId;
            result[i] = listings[listingId];
        }
    }

    function getListingsBySeller(
        address seller
    ) external view returns (Listing[] memory result, uint256[] memory ids) {
        uint256[] storage sellerIds = _sellerListings[seller];
        uint256 activeCount;
        for (uint256 i = 0; i < sellerIds.length; i++) {
            if (listings[sellerIds[i]].isActive) activeCount++;
        }

        result = new Listing[](activeCount);
        ids = new uint256[](activeCount);
        uint256 index;
        for (uint256 i = 0; i < sellerIds.length && index < activeCount; i++) {
            if (listings[sellerIds[i]].isActive) {
                result[index] = listings[sellerIds[i]];
                ids[index] = sellerIds[i];
                index++;
            }
        }
    }

    function getListingIdForNFT(address nftContract, uint256 tokenId) external view returns (uint256) {
        uint256 listingId = nftToListingId[nftContract][tokenId];
        if (listingId != 0 && !listings[listingId].isActive) return 0;
        return listingId;
    }

    // ------------------------------------------------------------------
    // Treasury / recovery
    // ------------------------------------------------------------------

    function withdrawFees(address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = accumulatedFees;
        if (amount == 0) revert NoFeesToWithdraw();
        accumulatedFees = 0;
        farmToken.safeTransfer(recipient, amount);
        emit FeesWithdrawn(recipient, amount);
    }

    /**
     * @notice Recovers an NFT sent here outside the listing flow.
     * @dev Reverts if the token backs an active listing, so escrowed goods
     *      are not seizable by the operator.
     */
    function rescueNFT(
        address nftContract,
        uint256 tokenId,
        address recipient
    ) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 listingId = nftToListingId[nftContract][tokenId];
        if (listingId != 0 && listings[listingId].isActive) {
            revert TokenIsListed(nftContract, tokenId);
        }
        IERC721(nftContract).safeTransferFrom(address(this), recipient, tokenId);
        emit NFTRescued(nftContract, tokenId, recipient);
    }

    // ------------------------------------------------------------------
    // Active-listing index
    // ------------------------------------------------------------------

    function _addActiveListing(uint256 listingId) internal {
        _activeListingIds.push(listingId);
        _activeListingIndex[listingId] = _activeListingIds.length;
    }

    function _removeActiveListing(uint256 listingId) internal {
        uint256 indexPlusOne = _activeListingIndex[listingId];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _activeListingIds.length - 1;
        if (index != lastIndex) {
            uint256 moved = _activeListingIds[lastIndex];
            _activeListingIds[index] = moved;
            _activeListingIndex[moved] = index + 1;
        }
        _activeListingIds.pop();
        delete _activeListingIndex[listingId];
    }
}
