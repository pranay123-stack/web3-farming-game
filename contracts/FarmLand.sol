// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FarmLand
 * @dev ERC721 NFT contract for land plots in the farming game
 * Limited supply of 1000 plots with unique coordinates
 */
contract FarmLand is ERC721, ERC721URIStorage, ERC721Enumerable, Ownable, ReentrancyGuard {
    // Maximum number of land plots
    uint256 public constant MAX_SUPPLY = 1000;

    // Grid dimensions (100x10 = 1000 plots)
    uint256 public constant GRID_WIDTH = 100;
    uint256 public constant GRID_HEIGHT = 10;

    // Land plot data
    struct LandPlot {
        uint256 x;              // X coordinate (0-99)
        uint256 y;              // Y coordinate (0-9)
        uint256 fertility;      // Base fertility level (affects yields)
        uint256 level;          // Upgrade level (0-10)
        bool isLocked;          // Whether the land is locked for farming
        uint256 lockedUntil;    // Timestamp when land becomes unlocked
        uint256 plantedSeedId;  // ID of the planted seed NFT (0 if none)
        uint256 plantedAt;      // Timestamp when seed was planted
        bool isActive;          // Whether the plot exists
    }

    // Token ID counter
    uint256 private _tokenIdCounter;

    // Mapping from token ID to LandPlot data
    mapping(uint256 => LandPlot) public landPlots;

    // Mapping from coordinates to token ID
    mapping(uint256 => mapping(uint256 => uint256)) public coordinateToTokenId;

    // Mapping to check if coordinates are taken
    mapping(uint256 => mapping(uint256 => bool)) public coordinatesTaken;

    // Mapping of addresses authorized to interact (game contracts)
    mapping(address => bool) public operators;

    // Price to mint a land plot (in native currency)
    uint256 public mintPrice;

    // Base URI for metadata
    string private _baseTokenURI;

    // Events
    event LandMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 x,
        uint256 y,
        uint256 fertility
    );
    event LandLocked(uint256 indexed tokenId, uint256 until, uint256 seedId);
    event LandUnlocked(uint256 indexed tokenId);
    event LandUpgraded(uint256 indexed tokenId, uint256 newLevel);
    event OperatorAdded(address indexed account);
    event OperatorRemoved(address indexed account);
    event MintPriceUpdated(uint256 newPrice);

    /**
     * @dev Constructor initializes the land collection
     * @param initialOwner The address that will own the contract
     * @param baseURI The base URI for token metadata
     * @param initialMintPrice The initial price to mint a land plot
     */
    constructor(
        address initialOwner,
        string memory baseURI,
        uint256 initialMintPrice
    ) ERC721("Farm Land", "FLAND") Ownable(initialOwner) {
        _baseTokenURI = baseURI;
        mintPrice = initialMintPrice;
    }

    /**
     * @dev Modifier to check if the caller is an operator
     */
    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == owner(), "FarmLand: caller is not an operator");
        _;
    }

    /**
     * @dev Adds an address as an authorized operator
     * @param account The address to add as an operator
     */
    function addOperator(address account) external onlyOwner {
        require(account != address(0), "FarmLand: operator is zero address");
        require(!operators[account], "FarmLand: account is already an operator");
        operators[account] = true;
        emit OperatorAdded(account);
    }

    /**
     * @dev Removes an address from authorized operators
     * @param account The address to remove as an operator
     */
    function removeOperator(address account) external onlyOwner {
        require(operators[account], "FarmLand: account is not an operator");
        operators[account] = false;
        emit OperatorRemoved(account);
    }

    /**
     * @dev Updates the mint price
     * @param newPrice The new mint price
     */
    function setMintPrice(uint256 newPrice) external onlyOwner {
        mintPrice = newPrice;
        emit MintPriceUpdated(newPrice);
    }

    /**
     * @dev Mints a land plot at specific coordinates
     * @param to The address to receive the NFT
     * @param x The X coordinate
     * @param y The Y coordinate
     * @return tokenId The ID of the newly minted token
     */
    function mintLand(address to, uint256 x, uint256 y) external payable nonReentrant returns (uint256) {
        require(to != address(0), "FarmLand: mint to zero address");
        require(_tokenIdCounter < MAX_SUPPLY, "FarmLand: max supply reached");
        require(x < GRID_WIDTH, "FarmLand: x coordinate out of bounds");
        require(y < GRID_HEIGHT, "FarmLand: y coordinate out of bounds");
        require(!coordinatesTaken[x][y], "FarmLand: coordinates already taken");

        // Check payment (owner and operators can mint for free)
        if (msg.sender != owner() && !operators[msg.sender]) {
            require(msg.value >= mintPrice, "FarmLand: insufficient payment");
        }

        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;

        _safeMint(to, tokenId);

        // Generate random fertility (50-100)
        uint256 fertility = 50 + (uint256(keccak256(abi.encodePacked(block.timestamp, tokenId, x, y))) % 51);

        landPlots[tokenId] = LandPlot({
            x: x,
            y: y,
            fertility: fertility,
            level: 0,
            isLocked: false,
            lockedUntil: 0,
            plantedSeedId: 0,
            plantedAt: 0,
            isActive: true
        });

        coordinateToTokenId[x][y] = tokenId;
        coordinatesTaken[x][y] = true;

        // Generate token URI based on coordinates
        string memory tokenURI_ = string(
            abi.encodePacked(_baseTokenURI, "/land/", _toString(x), "-", _toString(y), ".json")
        );
        _setTokenURI(tokenId, tokenURI_);

        emit LandMinted(tokenId, to, x, y, fertility);

        return tokenId;
    }

    /**
     * @dev Mints a land plot at the next available coordinates (auto-assign)
     * @param to The address to receive the NFT
     * @return tokenId The ID of the newly minted token
     */
    function mintLandAuto(address to) external payable nonReentrant returns (uint256) {
        require(to != address(0), "FarmLand: mint to zero address");
        require(_tokenIdCounter < MAX_SUPPLY, "FarmLand: max supply reached");

        // Check payment (owner and operators can mint for free)
        if (msg.sender != owner() && !operators[msg.sender]) {
            require(msg.value >= mintPrice, "FarmLand: insufficient payment");
        }

        // Find next available coordinates
        uint256 x;
        uint256 y;
        bool found = false;

        for (uint256 i = 0; i < GRID_WIDTH && !found; i++) {
            for (uint256 j = 0; j < GRID_HEIGHT && !found; j++) {
                if (!coordinatesTaken[i][j]) {
                    x = i;
                    y = j;
                    found = true;
                }
            }
        }

        require(found, "FarmLand: no available coordinates");

        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;

        _safeMint(to, tokenId);

        // Generate random fertility (50-100)
        uint256 fertility = 50 + (uint256(keccak256(abi.encodePacked(block.timestamp, tokenId, x, y))) % 51);

        landPlots[tokenId] = LandPlot({
            x: x,
            y: y,
            fertility: fertility,
            level: 0,
            isLocked: false,
            lockedUntil: 0,
            plantedSeedId: 0,
            plantedAt: 0,
            isActive: true
        });

        coordinateToTokenId[x][y] = tokenId;
        coordinatesTaken[x][y] = true;

        // Generate token URI
        string memory tokenURI_ = string(
            abi.encodePacked(_baseTokenURI, "/land/", _toString(x), "-", _toString(y), ".json")
        );
        _setTokenURI(tokenId, tokenURI_);

        emit LandMinted(tokenId, to, x, y, fertility);

        return tokenId;
    }

    /**
     * @dev Locks a land plot for farming
     * @param tokenId The ID of the land plot
     * @param duration How long to lock the land
     * @param seedId The ID of the planted seed NFT
     */
    function lockLand(uint256 tokenId, uint256 duration, uint256 seedId) external onlyOperator {
        require(landPlots[tokenId].isActive, "FarmLand: land does not exist");
        require(!landPlots[tokenId].isLocked, "FarmLand: land already locked");

        landPlots[tokenId].isLocked = true;
        landPlots[tokenId].lockedUntil = block.timestamp + duration;
        landPlots[tokenId].plantedSeedId = seedId;
        landPlots[tokenId].plantedAt = block.timestamp;

        emit LandLocked(tokenId, landPlots[tokenId].lockedUntil, seedId);
    }

    /**
     * @dev Unlocks a land plot after farming
     * @param tokenId The ID of the land plot
     */
    function unlockLand(uint256 tokenId) external onlyOperator {
        require(landPlots[tokenId].isActive, "FarmLand: land does not exist");
        require(landPlots[tokenId].isLocked, "FarmLand: land not locked");

        landPlots[tokenId].isLocked = false;
        landPlots[tokenId].lockedUntil = 0;
        landPlots[tokenId].plantedSeedId = 0;
        landPlots[tokenId].plantedAt = 0;

        emit LandUnlocked(tokenId);
    }

    /**
     * @dev Upgrades a land plot
     * @param tokenId The ID of the land plot
     */
    function upgradeLand(uint256 tokenId) external onlyOperator {
        require(landPlots[tokenId].isActive, "FarmLand: land does not exist");
        require(landPlots[tokenId].level < 10, "FarmLand: max level reached");

        landPlots[tokenId].level++;

        // Increase fertility with each upgrade
        landPlots[tokenId].fertility += 5;

        emit LandUpgraded(tokenId, landPlots[tokenId].level);
    }

    /**
     * @dev Gets the land plot data
     * @param tokenId The ID of the land plot
     * @return The LandPlot struct
     */
    function getLandPlot(uint256 tokenId) external view returns (LandPlot memory) {
        require(landPlots[tokenId].isActive, "FarmLand: land does not exist");
        return landPlots[tokenId];
    }

    /**
     * @dev Checks if a land plot is ready to harvest
     * @param tokenId The ID of the land plot
     * @return bool True if ready to harvest
     */
    function isReadyToHarvest(uint256 tokenId) external view returns (bool) {
        if (!landPlots[tokenId].isActive || !landPlots[tokenId].isLocked) {
            return false;
        }
        return block.timestamp >= landPlots[tokenId].lockedUntil;
    }

    /**
     * @dev Gets all land plots owned by an address
     * @param owner The address to query
     * @return An array of token IDs
     */
    function getLandsByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokens = new uint256[](balance);

        for (uint256 i = 0; i < balance; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner, i);
        }

        return tokens;
    }

    /**
     * @dev Gets the token ID at specific coordinates
     * @param x The X coordinate
     * @param y The Y coordinate
     * @return tokenId The token ID (0 if not minted)
     */
    function getTokenIdByCoordinates(uint256 x, uint256 y) external view returns (uint256) {
        require(coordinatesTaken[x][y], "FarmLand: coordinates not minted");
        return coordinateToTokenId[x][y];
    }

    /**
     * @dev Gets the current supply
     * @return The number of minted land plots
     */
    function getCurrentSupply() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Sets the base URI
     * @param baseURI The new base URI
     */
    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    /**
     * @dev Withdraws collected ETH to owner
     */
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "FarmLand: no balance to withdraw");
        payable(owner()).transfer(balance);
    }

    /**
     * @dev Internal function to convert uint to string
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
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
        // Prevent transfer of locked land
        if (to != address(0) && landPlots[tokenId].isActive && landPlots[tokenId].isLocked) {
            revert("FarmLand: cannot transfer locked land");
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
