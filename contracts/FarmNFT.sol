// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FarmNFT
 * @dev ERC721 NFT contract for game items including tools, seeds, and crops
 * Each NFT has a type, rarity, and associated metadata
 */
contract FarmNFT is ERC721, ERC721URIStorage, ERC721Enumerable, Ownable {
    // Item types enum
    enum ItemType {
        TOOL,      // 0 - Farming tools (hoe, watering can, etc.)
        SEED,      // 1 - Plantable seeds
        CROP,      // 2 - Harvested crops
        AVATAR,    // 3 - Player avatars
        CONSUMABLE // 4 - Consumable items (fertilizer, etc.)
    }

    // Rarity levels
    enum Rarity {
        COMMON,    // 0
        UNCOMMON,  // 1
        RARE,      // 2
        EPIC,      // 3
        LEGENDARY  // 4
    }

    // Item struct to store NFT properties
    struct Item {
        ItemType itemType;
        Rarity rarity;
        uint256 power;        // Base stat/power of the item
        uint256 durability;   // Remaining uses (for tools)
        uint256 growthTime;   // Growth time in seconds (for seeds)
        uint256 yieldAmount;  // Token yield when harvested (for crops)
        bool isActive;        // Whether the item exists
    }

    // Token ID counter
    uint256 private _tokenIdCounter;

    // Mapping from token ID to Item data
    mapping(uint256 => Item) public items;

    // Mapping of addresses authorized to mint (game contracts)
    mapping(address => bool) public minters;

    // Base URI for metadata
    string private _baseTokenURI;

    // Events
    event ItemMinted(
        uint256 indexed tokenId,
        address indexed to,
        ItemType itemType,
        Rarity rarity,
        uint256 power
    );
    event ItemBurned(uint256 indexed tokenId, address indexed owner);
    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);
    event DurabilityUpdated(uint256 indexed tokenId, uint256 newDurability);

    /**
     * @dev Constructor initializes the NFT collection
     * @param initialOwner The address that will own the contract
     * @param baseURI The base URI for token metadata
     */
    constructor(
        address initialOwner,
        string memory baseURI
    ) ERC721("Farm Items", "FITEM") Ownable(initialOwner) {
        _baseTokenURI = baseURI;
    }

    /**
     * @dev Modifier to check if the caller is a minter
     */
    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "FarmNFT: caller is not a minter");
        _;
    }

    /**
     * @dev Adds an address as an authorized minter
     * @param account The address to add as a minter
     */
    function addMinter(address account) external onlyOwner {
        require(account != address(0), "FarmNFT: minter is zero address");
        require(!minters[account], "FarmNFT: account is already a minter");
        minters[account] = true;
        emit MinterAdded(account);
    }

    /**
     * @dev Removes an address from authorized minters
     * @param account The address to remove as a minter
     */
    function removeMinter(address account) external onlyOwner {
        require(minters[account], "FarmNFT: account is not a minter");
        minters[account] = false;
        emit MinterRemoved(account);
    }

    /**
     * @dev Mints a new item NFT
     * @param to The address to receive the NFT
     * @param itemType The type of item
     * @param rarity The rarity level
     * @param power The base power/stat of the item
     * @param durability The initial durability
     * @param growthTime Growth time for seeds
     * @param yieldAmount Yield amount for crops
     * @param tokenURI_ The metadata URI for this specific token
     * @return tokenId The ID of the newly minted token
     */
    function mintItem(
        address to,
        ItemType itemType,
        Rarity rarity,
        uint256 power,
        uint256 durability,
        uint256 growthTime,
        uint256 yieldAmount,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        require(to != address(0), "FarmNFT: mint to zero address");

        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);

        items[tokenId] = Item({
            itemType: itemType,
            rarity: rarity,
            power: power,
            durability: durability,
            growthTime: growthTime,
            yieldAmount: yieldAmount,
            isActive: true
        });

        emit ItemMinted(tokenId, to, itemType, rarity, power);

        return tokenId;
    }

    /**
     * @dev Mints a simple tool
     * @param to The address to receive the NFT
     * @param rarity The rarity level
     * @param power Tool power (affects farming efficiency)
     * @param durability Number of uses
     * @param tokenURI_ The metadata URI
     * @return tokenId The ID of the newly minted token
     */
    function mintTool(
        address to,
        Rarity rarity,
        uint256 power,
        uint256 durability,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        return this.mintItem(to, ItemType.TOOL, rarity, power, durability, 0, 0, tokenURI_);
    }

    /**
     * @dev Mints a seed NFT
     * @param to The address to receive the NFT
     * @param rarity The rarity level
     * @param growthTime Time in seconds for the seed to grow
     * @param yieldAmount Tokens earned when harvesting
     * @param tokenURI_ The metadata URI
     * @return tokenId The ID of the newly minted token
     */
    function mintSeed(
        address to,
        Rarity rarity,
        uint256 growthTime,
        uint256 yieldAmount,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        return this.mintItem(to, ItemType.SEED, rarity, 0, 0, growthTime, yieldAmount, tokenURI_);
    }

    /**
     * @dev Mints a crop NFT (result of harvesting)
     * @param to The address to receive the NFT
     * @param rarity The rarity level
     * @param yieldAmount Token value of the crop
     * @param tokenURI_ The metadata URI
     * @return tokenId The ID of the newly minted token
     */
    function mintCrop(
        address to,
        Rarity rarity,
        uint256 yieldAmount,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        return this.mintItem(to, ItemType.CROP, rarity, 0, 0, 0, yieldAmount, tokenURI_);
    }

    /**
     * @dev Burns an NFT (used for crafting, planting, etc.)
     * @param tokenId The ID of the token to burn
     */
    function burn(uint256 tokenId) external {
        require(
            msg.sender == ownerOf(tokenId) || minters[msg.sender] || msg.sender == owner(),
            "FarmNFT: caller is not owner or authorized"
        );

        address tokenOwner = ownerOf(tokenId);
        delete items[tokenId];
        _burn(tokenId);

        emit ItemBurned(tokenId, tokenOwner);
    }

    /**
     * @dev Updates the durability of a tool
     * @param tokenId The ID of the tool
     * @param newDurability The new durability value
     */
    function updateDurability(uint256 tokenId, uint256 newDurability) external onlyMinter {
        require(items[tokenId].isActive, "FarmNFT: item does not exist");
        require(items[tokenId].itemType == ItemType.TOOL, "FarmNFT: not a tool");

        items[tokenId].durability = newDurability;
        emit DurabilityUpdated(tokenId, newDurability);
    }

    /**
     * @dev Gets the item data for a token
     * @param tokenId The ID of the token
     * @return The Item struct
     */
    function getItem(uint256 tokenId) external view returns (Item memory) {
        require(items[tokenId].isActive, "FarmNFT: item does not exist");
        return items[tokenId];
    }

    /**
     * @dev Gets all tokens owned by an address
     * @param owner The address to query
     * @return An array of token IDs
     */
    function getTokensByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokens = new uint256[](balance);

        for (uint256 i = 0; i < balance; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner, i);
        }

        return tokens;
    }

    /**
     * @dev Gets the current token ID counter
     * @return The next token ID to be minted
     */
    function getCurrentTokenId() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Sets the base URI for all tokens
     * @param baseURI The new base URI
     */
    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    /**
     * @dev Returns the base URI
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // Required overrides for multiple inheritance

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(
        address account,
        uint128 value
    ) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
