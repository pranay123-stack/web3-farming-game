// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title FarmNFT
 * @notice ERC-721 for every non-land game object: tools, seeds, harvested crops
 *         and consumables. Each token carries its gameplay stats on-chain.
 *
 * @dev Authorisation model
 * -----------------------
 * `minters` are game contracts (in practice only `GameManager`). They may mint
 * new items and may burn tokens *as part of a game action they have already
 * authorised* - planting burns the seed, crafting can burn inputs.
 *
 * Burning is deliberately split in two:
 *   - {burn} lets the token owner (or an ERC-721 approved operator) destroy
 *     their own token.
 *   - {gameBurn} lets a minter destroy a token, but ONLY after asserting the
 *     expected owner. `GameManager` passes the player it has already checked,
 *     so a mis-ordered or replayed call cannot burn a bystander's NFT.
 *
 * The previous version let any minter burn *any* token with no owner
 * assertion, which made a bug in `GameManager` sufficient to destroy arbitrary
 * player inventory.
 */
contract FarmNFT is ERC721, ERC721URIStorage, ERC721Enumerable, Ownable2Step {
    enum ItemType {
        TOOL,       // 0 - hoe, watering can...
        SEED,       // 1 - plantable
        CROP,       // 2 - harvest output
        AVATAR,     // 3 - cosmetic
        CONSUMABLE  // 4 - fertiliser...
    }

    enum Rarity {
        COMMON,    // 0
        UNCOMMON,  // 1
        RARE,      // 2
        EPIC,      // 3
        LEGENDARY  // 4
    }

    struct Item {
        ItemType itemType;
        Rarity rarity;
        uint256 power;        // generic stat (tool strength, fertiliser boost)
        uint256 durability;   // remaining uses, tools only
        uint256 growthTime;   // seconds to maturity, seeds only
        uint256 yieldAmount;  // FGOLD yield, seeds and crops
        uint256 seedTypeId;   // originating seed type, seeds and crops (0 if n/a)
        bool exists;
    }

    /// @dev Token ids start at 1 so that `0` is an unambiguous "no token" sentinel.
    uint256 private _nextTokenId = 1;

    mapping(uint256 => Item) private _items;
    mapping(address => bool) public minters;

    string private _baseTokenURI;

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
    event BaseURIUpdated(string newBaseURI);

    error NotMinter(address caller);
    error ZeroAddress();
    error AlreadyMinter(address account);
    error NotAMinter(address account);
    error ItemDoesNotExist(uint256 tokenId);
    error NotOwnerNorApproved(uint256 tokenId, address caller);
    error UnexpectedOwner(uint256 tokenId, address expected, address actual);
    error NotATool(uint256 tokenId);

    constructor(
        address initialOwner,
        string memory baseURI
    ) ERC721("Farm Items", "FITEM") Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        _baseTokenURI = baseURI;
    }

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert NotMinter(msg.sender);
        _;
    }

    function addMinter(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (minters[account]) revert AlreadyMinter(account);
        minters[account] = true;
        emit MinterAdded(account);
    }

    function removeMinter(address account) external onlyOwner {
        if (!minters[account]) revert NotAMinter(account);
        minters[account] = false;
        emit MinterRemoved(account);
    }

    // ------------------------------------------------------------------
    // Minting
    // ------------------------------------------------------------------

    /**
     * @notice Mints an item with fully specified stats.
     * @dev The convenience wrappers below call the INTERNAL `_mintItem`.
     *      They previously called `this.mintItem(...)`, which re-entered the
     *      contract as an external call and therefore arrived with
     *      `msg.sender == address(this)`. Since the contract was never its own
     *      minter, `mintSeed`/`mintTool`/`mintCrop` reverted unconditionally -
     *      which in turn made seed purchase (and so the entire game loop)
     *      impossible. Keeping the dispatch internal is the fix.
     */
    function mintItem(
        address to,
        ItemType itemType,
        Rarity rarity,
        uint256 power,
        uint256 durability,
        uint256 growthTime,
        uint256 yieldAmount,
        uint256 seedTypeId,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        return _mintItem(to, itemType, rarity, power, durability, growthTime, yieldAmount, seedTypeId, tokenURI_);
    }

    function mintTool(
        address to,
        Rarity rarity,
        uint256 power,
        uint256 durability,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        return _mintItem(to, ItemType.TOOL, rarity, power, durability, 0, 0, 0, tokenURI_);
    }

    function mintSeed(
        address to,
        Rarity rarity,
        uint256 growthTime,
        uint256 yieldAmount,
        uint256 seedTypeId,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        return _mintItem(to, ItemType.SEED, rarity, 0, 0, growthTime, yieldAmount, seedTypeId, tokenURI_);
    }

    function mintCrop(
        address to,
        Rarity rarity,
        uint256 yieldAmount,
        uint256 seedTypeId,
        string memory tokenURI_
    ) external onlyMinter returns (uint256) {
        return _mintItem(to, ItemType.CROP, rarity, 0, 0, 0, yieldAmount, seedTypeId, tokenURI_);
    }

    function _mintItem(
        address to,
        ItemType itemType,
        Rarity rarity,
        uint256 power,
        uint256 durability,
        uint256 growthTime,
        uint256 yieldAmount,
        uint256 seedTypeId,
        string memory tokenURI_
    ) internal returns (uint256) {
        if (to == address(0)) revert ZeroAddress();

        uint256 tokenId = _nextTokenId++;

        // Stats are written BEFORE _safeMint so that an ERC721Receiver hook
        // observing the incoming token sees a fully-initialised item.
        _items[tokenId] = Item({
            itemType: itemType,
            rarity: rarity,
            power: power,
            durability: durability,
            growthTime: growthTime,
            yieldAmount: yieldAmount,
            seedTypeId: seedTypeId,
            exists: true
        });

        _safeMint(to, tokenId);
        if (bytes(tokenURI_).length > 0) {
            _setTokenURI(tokenId, tokenURI_);
        }

        emit ItemMinted(tokenId, to, itemType, rarity, power);
        return tokenId;
    }

    // ------------------------------------------------------------------
    // Burning
    // ------------------------------------------------------------------

    /// @notice Destroys a token. Caller must be its owner or an approved operator.
    function burn(uint256 tokenId) external {
        if (!_items[tokenId].exists) revert ItemDoesNotExist(tokenId);
        if (!_isAuthorized(_ownerOf(tokenId), msg.sender, tokenId)) {
            revert NotOwnerNorApproved(tokenId, msg.sender);
        }
        _burnItem(tokenId);
    }

    /**
     * @notice Minter-only burn that asserts the token's owner first.
     * @param expectedOwner The address the caller believes owns `tokenId`.
     *        Reverts if it does not, so a stale or replayed game action cannot
     *        destroy someone else's item.
     */
    function gameBurn(uint256 tokenId, address expectedOwner) external onlyMinter {
        if (!_items[tokenId].exists) revert ItemDoesNotExist(tokenId);
        address actualOwner = _ownerOf(tokenId);
        if (actualOwner != expectedOwner) {
            revert UnexpectedOwner(tokenId, expectedOwner, actualOwner);
        }
        _burnItem(tokenId);
    }

    function _burnItem(uint256 tokenId) internal {
        address tokenOwner = _ownerOf(tokenId);
        delete _items[tokenId];
        _burn(tokenId);
        emit ItemBurned(tokenId, tokenOwner);
    }

    // ------------------------------------------------------------------
    // Stats & views
    // ------------------------------------------------------------------

    function updateDurability(uint256 tokenId, uint256 newDurability) external onlyMinter {
        if (!_items[tokenId].exists) revert ItemDoesNotExist(tokenId);
        if (_items[tokenId].itemType != ItemType.TOOL) revert NotATool(tokenId);
        _items[tokenId].durability = newDurability;
        emit DurabilityUpdated(tokenId, newDurability);
    }

    function getItem(uint256 tokenId) external view returns (Item memory) {
        if (!_items[tokenId].exists) revert ItemDoesNotExist(tokenId);
        return _items[tokenId];
    }

    /// @notice Non-reverting variant for UIs enumerating possibly-burned ids.
    function tryGetItem(uint256 tokenId) external view returns (bool found, Item memory item) {
        item = _items[tokenId];
        found = item.exists;
    }

    function itemExists(uint256 tokenId) external view returns (bool) {
        return _items[tokenId].exists;
    }

    /// @notice Every token id held by `owner`. View-only; unbounded by design.
    function getTokensByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokens = new uint256[](balance);
        for (uint256 i = 0; i < balance; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner, i);
        }
        return tokens;
    }

    /**
     * @notice Paginated inventory read with full stats, for the game client.
     * @dev Returning stats alongside ids collapses what would otherwise be
     *      1 + N RPC round-trips into one.
     */
    function getInventory(
        address owner,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory tokenIds, Item[] memory itemData) {
        uint256 balance = balanceOf(owner);
        if (offset >= balance) {
            return (new uint256[](0), new Item[](0));
        }
        uint256 size = balance - offset;
        if (size > limit) size = limit;

        tokenIds = new uint256[](size);
        itemData = new Item[](size);
        for (uint256 i = 0; i < size; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(owner, offset + i);
            tokenIds[i] = tokenId;
            itemData[i] = _items[tokenId];
        }
    }

    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURIUpdated(baseURI);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ------------------------------------------------------------------
    // Multiple-inheritance overrides
    // ------------------------------------------------------------------

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
