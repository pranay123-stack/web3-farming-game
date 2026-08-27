// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title FarmLand
 * @notice ERC-721 land plots. Fixed supply, unique grid coordinates, and the
 *         substrate every farming action is anchored to.
 *
 * @dev Locking
 * ----------
 * While a crop is growing the plot is locked. A locked plot cannot be
 * transferred (enforced in {_update}), which is what makes `GameManager`'s
 * "the land owner at harvest is the player who planted" assumption safe: the
 * owner cannot change between plant and harvest.
 *
 * Token ids start at 1. Id 0 is reserved as the "no plot here" sentinel used
 * by {coordinateToTokenId}; the previous version started at 0, making plot #0
 * indistinguishable from an unminted coordinate.
 */
contract FarmLand is ERC721, ERC721URIStorage, ERC721Enumerable, Ownable2Step, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public constant GRID_WIDTH = 100;
    uint256 public constant GRID_HEIGHT = 10;
    uint256 public constant MAX_LEVEL = 10;

    /// @notice Fertility granted per upgrade level.
    uint256 public constant FERTILITY_PER_LEVEL = 5;
    uint256 public constant MIN_BASE_FERTILITY = 50;
    uint256 public constant BASE_FERTILITY_RANGE = 51; // 50..100 inclusive

    struct LandPlot {
        uint256 x;
        uint256 y;
        uint256 fertility;      // yield modifier, in percent
        uint256 level;          // upgrade level, 0..MAX_LEVEL
        bool isLocked;          // true while a crop is growing
        uint256 lockedUntil;    // timestamp the crop matures
        uint256 plantedSeedId;  // seed NFT that was consumed (0 if idle)
        uint256 plantedAt;
        bool exists;
    }

    uint256 private _nextTokenId = 1;

    /// @dev Cursor for {mintLandAuto}. Monotonic, so auto-minting stays O(1)
    ///      amortised instead of rescanning the whole grid on every mint.
    uint256 private _autoMintCursor;

    mapping(uint256 => LandPlot) private _landPlots;
    mapping(uint256 => mapping(uint256 => uint256)) public coordinateToTokenId; // x => y => tokenId (0 = none)
    mapping(address => bool) public operators;

    uint256 public mintPrice;
    string private _baseTokenURI;

    event LandMinted(uint256 indexed tokenId, address indexed to, uint256 x, uint256 y, uint256 fertility);
    event LandLocked(uint256 indexed tokenId, uint256 until, uint256 seedId);
    event LandUnlocked(uint256 indexed tokenId);
    event LandUpgraded(uint256 indexed tokenId, uint256 newLevel, uint256 newFertility);
    event OperatorAdded(address indexed account);
    event OperatorRemoved(address indexed account);
    event MintPriceUpdated(uint256 newPrice);
    event BaseURIUpdated(string newBaseURI);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOperator(address caller);
    error ZeroAddress();
    error AlreadyOperator(address account);
    error NotAnOperator(address account);
    error MaxSupplyReached();
    error CoordinateOutOfBounds(uint256 x, uint256 y);
    error CoordinateTaken(uint256 x, uint256 y);
    error InsufficientPayment(uint256 sent, uint256 required);
    error PlotDoesNotExist(uint256 tokenId);
    error PlotAlreadyLocked(uint256 tokenId);
    error PlotNotLocked(uint256 tokenId);
    error MaxLevelReached(uint256 tokenId);
    error PlotIsLocked(uint256 tokenId);
    error NothingToWithdraw();
    error TransferFailed();
    error NoAvailableCoordinates();

    constructor(
        address initialOwner,
        string memory baseURI,
        uint256 initialMintPrice
    ) ERC721("Farm Land", "FLAND") Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        _baseTokenURI = baseURI;
        mintPrice = initialMintPrice;
    }

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert NotOperator(msg.sender);
        _;
    }

    function addOperator(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (operators[account]) revert AlreadyOperator(account);
        operators[account] = true;
        emit OperatorAdded(account);
    }

    function removeOperator(address account) external onlyOwner {
        if (!operators[account]) revert NotAnOperator(account);
        operators[account] = false;
        emit OperatorRemoved(account);
    }

    function setMintPrice(uint256 newPrice) external onlyOwner {
        mintPrice = newPrice;
        emit MintPriceUpdated(newPrice);
    }

    // ------------------------------------------------------------------
    // Minting
    // ------------------------------------------------------------------

    /// @notice Mints the plot at (`x`, `y`) to `to`. Payable at {mintPrice}.
    function mintLand(address to, uint256 x, uint256 y) external payable nonReentrant returns (uint256) {
        if (x >= GRID_WIDTH || y >= GRID_HEIGHT) revert CoordinateOutOfBounds(x, y);
        if (coordinateToTokenId[x][y] != 0) revert CoordinateTaken(x, y);
        uint256 refund = _collectPayment();
        uint256 tokenId = _mintPlot(to, x, y);
        _refund(refund);
        return tokenId;
    }

    /**
     * @notice Mints the next free plot to `to`.
     * @dev Walks a persistent cursor rather than rescanning the grid. The old
     *      implementation ran a nested 100x10 loop of cold SLOADs on every
     *      call, so minting the last plots cost more gas than a block allows.
     */
    function mintLandAuto(address to) external payable nonReentrant returns (uint256) {
        uint256 refund = _collectPayment();

        uint256 cursor = _autoMintCursor;
        uint256 total = GRID_WIDTH * GRID_HEIGHT;
        uint256 x;
        uint256 y;
        bool found;

        while (cursor < total) {
            x = cursor / GRID_HEIGHT;
            y = cursor % GRID_HEIGHT;
            cursor++;
            if (coordinateToTokenId[x][y] == 0) {
                found = true;
                break;
            }
        }
        _autoMintCursor = cursor;
        if (!found) revert NoAvailableCoordinates();

        uint256 tokenId = _mintPlot(to, x, y);
        _refund(refund);
        return tokenId;
    }

    /**
     * @notice Operator-only free mint, used by the starter pack in `GameManager`.
     * @dev Kept separate from the payable paths so the "operators mint free"
     *      exemption is an explicit entry point rather than a branch inside a
     *      user-facing payable function.
     */
    function mintLandFor(address to, uint256 x, uint256 y) external onlyOperator returns (uint256) {
        if (x >= GRID_WIDTH || y >= GRID_HEIGHT) revert CoordinateOutOfBounds(x, y);
        if (coordinateToTokenId[x][y] != 0) revert CoordinateTaken(x, y);
        return _mintPlot(to, x, y);
    }

    /// @notice Operator-only free auto-mint (starter pack).
    function mintLandAutoFor(address to) external onlyOperator returns (uint256) {
        uint256 cursor = _autoMintCursor;
        uint256 total = GRID_WIDTH * GRID_HEIGHT;
        uint256 x;
        uint256 y;
        bool found;

        while (cursor < total) {
            x = cursor / GRID_HEIGHT;
            y = cursor % GRID_HEIGHT;
            cursor++;
            if (coordinateToTokenId[x][y] == 0) {
                found = true;
                break;
            }
        }
        _autoMintCursor = cursor;
        if (!found) revert NoAvailableCoordinates();

        return _mintPlot(to, x, y);
    }

    function _collectPayment() internal returns (uint256 refund) {
        uint256 price = mintPrice;
        if (msg.value < price) revert InsufficientPayment(msg.value, price);
        refund = msg.value - price;
    }

    /// @dev Returns overpayment instead of silently keeping it.
    function _refund(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _mintPlot(address to, uint256 x, uint256 y) internal returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        if (_nextTokenId > MAX_SUPPLY) revert MaxSupplyReached();

        uint256 tokenId = _nextTokenId++;

        // Pseudo-random fertility. Miner-influenceable within a narrow band and
        // deliberately so: it is a cosmetic yield modifier (50-100%), not a
        // reward that would repay the cost of manipulating it. Documented
        // rather than papered over with a VRF the game does not need.
        uint256 fertility = MIN_BASE_FERTILITY +
            (uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), tokenId, x, y, to))) % BASE_FERTILITY_RANGE);

        _landPlots[tokenId] = LandPlot({
            x: x,
            y: y,
            fertility: fertility,
            level: 0,
            isLocked: false,
            lockedUntil: 0,
            plantedSeedId: 0,
            plantedAt: 0,
            exists: true
        });

        coordinateToTokenId[x][y] = tokenId;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, string(abi.encodePacked("land/", x.toString(), "-", y.toString(), ".json")));

        emit LandMinted(tokenId, to, x, y, fertility);
        return tokenId;
    }

    // ------------------------------------------------------------------
    // Farming state (operator-only)
    // ------------------------------------------------------------------

    function lockLand(uint256 tokenId, uint256 duration, uint256 seedId) external onlyOperator {
        LandPlot storage plot = _landPlots[tokenId];
        if (!plot.exists) revert PlotDoesNotExist(tokenId);
        if (plot.isLocked) revert PlotAlreadyLocked(tokenId);

        plot.isLocked = true;
        plot.lockedUntil = block.timestamp + duration;
        plot.plantedSeedId = seedId;
        plot.plantedAt = block.timestamp;

        emit LandLocked(tokenId, plot.lockedUntil, seedId);
    }

    function unlockLand(uint256 tokenId) external onlyOperator {
        LandPlot storage plot = _landPlots[tokenId];
        if (!plot.exists) revert PlotDoesNotExist(tokenId);
        if (!plot.isLocked) revert PlotNotLocked(tokenId);

        plot.isLocked = false;
        plot.lockedUntil = 0;
        plot.plantedSeedId = 0;
        plot.plantedAt = 0;

        emit LandUnlocked(tokenId);
    }

    function upgradeLand(uint256 tokenId) external onlyOperator {
        LandPlot storage plot = _landPlots[tokenId];
        if (!plot.exists) revert PlotDoesNotExist(tokenId);
        if (plot.isLocked) revert PlotIsLocked(tokenId);
        if (plot.level >= MAX_LEVEL) revert MaxLevelReached(tokenId);

        plot.level += 1;
        plot.fertility += FERTILITY_PER_LEVEL;

        emit LandUpgraded(tokenId, plot.level, plot.fertility);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getLandPlot(uint256 tokenId) external view returns (LandPlot memory) {
        if (!_landPlots[tokenId].exists) revert PlotDoesNotExist(tokenId);
        return _landPlots[tokenId];
    }

    function plotExists(uint256 tokenId) external view returns (bool) {
        return _landPlots[tokenId].exists;
    }

    function isReadyToHarvest(uint256 tokenId) external view returns (bool) {
        LandPlot storage plot = _landPlots[tokenId];
        if (!plot.exists || !plot.isLocked) return false;
        return block.timestamp >= plot.lockedUntil;
    }

    function getLandsByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokens = new uint256[](balance);
        for (uint256 i = 0; i < balance; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner, i);
        }
        return tokens;
    }

    /// @notice Paginated plots-with-data read, so the client needs one call.
    function getPlotsByOwner(
        address owner,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory tokenIds, LandPlot[] memory plots) {
        uint256 balance = balanceOf(owner);
        if (offset >= balance) {
            return (new uint256[](0), new LandPlot[](0));
        }
        uint256 size = balance - offset;
        if (size > limit) size = limit;

        tokenIds = new uint256[](size);
        plots = new LandPlot[](size);
        for (uint256 i = 0; i < size; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(owner, offset + i);
            tokenIds[i] = tokenId;
            plots[i] = _landPlots[tokenId];
        }
    }

    /// @notice Token id at (`x`, `y`), or 0 when that coordinate is unminted.
    function getTokenIdByCoordinates(uint256 x, uint256 y) external view returns (uint256) {
        return coordinateToTokenId[x][y];
    }

    function getCurrentSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURIUpdated(baseURI);
    }

    /// @dev Uses `call` rather than `transfer`: the 2300-gas stipend would
    ///      make withdrawal impossible once ownership moves to a multisig.
    function withdraw(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToWithdraw();
        (bool ok, ) = payable(to).call{value: balance}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, balance);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ------------------------------------------------------------------
    // Multiple-inheritance overrides
    // ------------------------------------------------------------------

    /// @dev Blocks transfer of a plot with a crop growing on it. Mints
    ///      (`from == 0`) and burns (`to == 0`) are exempt.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Enumerable) returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && _landPlots[tokenId].isLocked) {
            revert PlotIsLocked(tokenId);
        }
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
