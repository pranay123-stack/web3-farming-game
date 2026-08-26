// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./FarmToken.sol";
import "./FarmNFT.sol";
import "./FarmLand.sol";

/**
 * @title GameManager
 * @dev Core game logic contract for the GameFi farming game
 * Handles planting, harvesting, crafting, and game mechanics
 */
contract GameManager is Ownable, ReentrancyGuard {
    // Contract references
    FarmToken public farmToken;
    FarmNFT public farmNFT;
    FarmLand public farmLand;

    // Crafting recipes
    struct CraftingRecipe {
        uint256 tokenCost;              // FGOLD tokens required
        FarmNFT.ItemType resultType;    // Type of item produced
        FarmNFT.Rarity resultRarity;    // Rarity of item produced
        uint256 resultPower;            // Power stat of result
        uint256 resultDurability;       // Durability of result (for tools)
        uint256 resultGrowthTime;       // Growth time (for seeds)
        uint256 resultYield;            // Yield amount (for crops/seeds)
        string resultURI;               // Metadata URI for the result
        bool isActive;                  // Whether the recipe is active
    }

    // Seed types for planting
    struct SeedType {
        uint256 growthTime;     // Time in seconds to grow
        uint256 baseYield;      // Base FGOLD tokens earned
        uint256 seedCost;       // Cost to buy the seed in FGOLD
        string seedURI;         // Metadata URI for the seed
        string cropURI;         // Metadata URI for the harvested crop
        bool isActive;          // Whether this seed type is available
    }

    // Player farming data
    struct FarmingData {
        uint256 landTokenId;    // Land plot being farmed
        uint256 seedTokenId;    // Seed NFT planted
        uint256 plantedAt;      // Timestamp of planting
        uint256 harvestAt;      // Timestamp when harvest is ready
        uint256 expectedYield;  // Expected FGOLD yield
        bool isActive;          // Whether farming is in progress
    }

    // Mapping from recipe ID to recipe data
    mapping(uint256 => CraftingRecipe) public craftingRecipes;
    uint256 public recipeCount;

    // Mapping from seed type ID to seed data
    mapping(uint256 => SeedType) public seedTypes;
    uint256 public seedTypeCount;

    // Mapping from player address to their active farms (landTokenId => FarmingData)
    mapping(address => mapping(uint256 => FarmingData)) public playerFarms;

    // Mapping to track all active farm land IDs per player
    mapping(address => uint256[]) public playerActiveFarmLands;

    // Game constants
    uint256 public constant YIELD_MULTIPLIER_DECIMALS = 100; // For percentage calculations
    uint256 public harvestBonus = 10; // 10% bonus yield

    // Events
    event CropPlanted(
        address indexed player,
        uint256 indexed landTokenId,
        uint256 seedTokenId,
        uint256 harvestTime,
        uint256 expectedYield
    );
    event CropHarvested(
        address indexed player,
        uint256 indexed landTokenId,
        uint256 yieldAmount,
        uint256 bonusAmount
    );
    event ItemCrafted(
        address indexed player,
        uint256 recipeId,
        uint256 tokenId,
        uint256 tokenCost
    );
    event SeedPurchased(
        address indexed player,
        uint256 seedTypeId,
        uint256 tokenId,
        uint256 cost
    );
    event RecipeAdded(uint256 indexed recipeId, uint256 tokenCost, FarmNFT.ItemType resultType);
    event RecipeUpdated(uint256 indexed recipeId);
    event SeedTypeAdded(uint256 indexed seedTypeId, uint256 growthTime, uint256 baseYield);
    event LandUpgradeRequested(address indexed player, uint256 indexed landTokenId, uint256 cost);

    /**
     * @dev Constructor initializes the game manager
     * @param initialOwner The address that will own the contract
     * @param _farmToken Address of the FarmToken contract
     * @param _farmNFT Address of the FarmNFT contract
     * @param _farmLand Address of the FarmLand contract
     */
    constructor(
        address initialOwner,
        address _farmToken,
        address _farmNFT,
        address _farmLand
    ) Ownable(initialOwner) {
        require(_farmToken != address(0), "GameManager: invalid token address");
        require(_farmNFT != address(0), "GameManager: invalid NFT address");
        require(_farmLand != address(0), "GameManager: invalid land address");

        farmToken = FarmToken(_farmToken);
        farmNFT = FarmNFT(_farmNFT);
        farmLand = FarmLand(_farmLand);
    }

    /**
     * @dev Adds a new crafting recipe
     * @param tokenCost FGOLD tokens required
     * @param resultType Type of item produced
     * @param resultRarity Rarity of the result
     * @param resultPower Power stat
     * @param resultDurability Durability (for tools)
     * @param resultGrowthTime Growth time (for seeds)
     * @param resultYield Yield amount
     * @param resultURI Metadata URI
     */
    function addCraftingRecipe(
        uint256 tokenCost,
        FarmNFT.ItemType resultType,
        FarmNFT.Rarity resultRarity,
        uint256 resultPower,
        uint256 resultDurability,
        uint256 resultGrowthTime,
        uint256 resultYield,
        string memory resultURI
    ) external onlyOwner {
        uint256 recipeId = recipeCount;
        recipeCount++;

        craftingRecipes[recipeId] = CraftingRecipe({
            tokenCost: tokenCost,
            resultType: resultType,
            resultRarity: resultRarity,
            resultPower: resultPower,
            resultDurability: resultDurability,
            resultGrowthTime: resultGrowthTime,
            resultYield: resultYield,
            resultURI: resultURI,
            isActive: true
        });

        emit RecipeAdded(recipeId, tokenCost, resultType);
    }

    /**
     * @dev Updates an existing crafting recipe
     * @param recipeId The ID of the recipe to update
     * @param tokenCost New token cost
     * @param isActive Whether the recipe is active
     */
    function updateCraftingRecipe(
        uint256 recipeId,
        uint256 tokenCost,
        bool isActive
    ) external onlyOwner {
        require(recipeId < recipeCount, "GameManager: recipe does not exist");
        craftingRecipes[recipeId].tokenCost = tokenCost;
        craftingRecipes[recipeId].isActive = isActive;
        emit RecipeUpdated(recipeId);
    }

    /**
     * @dev Adds a new seed type
     * @param growthTime Time to grow in seconds
     * @param baseYield Base FGOLD yield
     * @param seedCost Cost to buy the seed
     * @param seedURI Metadata URI for the seed
     * @param cropURI Metadata URI for the crop
     */
    function addSeedType(
        uint256 growthTime,
        uint256 baseYield,
        uint256 seedCost,
        string memory seedURI,
        string memory cropURI
    ) external onlyOwner {
        uint256 seedTypeId = seedTypeCount;
        seedTypeCount++;

        seedTypes[seedTypeId] = SeedType({
            growthTime: growthTime,
            baseYield: baseYield,
            seedCost: seedCost,
            seedURI: seedURI,
            cropURI: cropURI,
            isActive: true
        });

        emit SeedTypeAdded(seedTypeId, growthTime, baseYield);
    }

    /**
     * @dev Purchases a seed using FGOLD tokens
     * @param seedTypeId The type of seed to purchase
     * @return tokenId The ID of the minted seed NFT
     */
    function purchaseSeed(uint256 seedTypeId) external nonReentrant returns (uint256) {
        require(seedTypeId < seedTypeCount, "GameManager: invalid seed type");
        SeedType storage seedType = seedTypes[seedTypeId];
        require(seedType.isActive, "GameManager: seed type not active");

        // Burn tokens for the seed
        farmToken.burnFrom(msg.sender, seedType.seedCost);

        // Mint seed NFT
        uint256 tokenId = farmNFT.mintSeed(
            msg.sender,
            FarmNFT.Rarity.COMMON,
            seedType.growthTime,
            seedType.baseYield,
            seedType.seedURI
        );

        emit SeedPurchased(msg.sender, seedTypeId, tokenId, seedType.seedCost);

        return tokenId;
    }

    /**
     * @dev Plants a seed on a land plot
     * @param landTokenId The ID of the land plot
     * @param seedTokenId The ID of the seed NFT
     */
    function plantCrop(uint256 landTokenId, uint256 seedTokenId) external nonReentrant {
        // Verify land ownership
        require(farmLand.ownerOf(landTokenId) == msg.sender, "GameManager: not land owner");

        // Verify seed ownership
        require(farmNFT.ownerOf(seedTokenId) == msg.sender, "GameManager: not seed owner");

        // Get land data
        FarmLand.LandPlot memory land = farmLand.getLandPlot(landTokenId);
        require(!land.isLocked, "GameManager: land already in use");

        // Get seed data
        FarmNFT.Item memory seed = farmNFT.getItem(seedTokenId);
        require(seed.itemType == FarmNFT.ItemType.SEED, "GameManager: not a seed");

        // Calculate yield based on land fertility and level
        uint256 yieldMultiplier = YIELD_MULTIPLIER_DECIMALS + land.fertility + (land.level * 10);
        uint256 expectedYield = (seed.yieldAmount * yieldMultiplier) / YIELD_MULTIPLIER_DECIMALS;

        uint256 harvestTime = block.timestamp + seed.growthTime;

        // Lock the land
        farmLand.lockLand(landTokenId, seed.growthTime, seedTokenId);

        // Burn the seed NFT
        farmNFT.burn(seedTokenId);

        // Store farming data
        playerFarms[msg.sender][landTokenId] = FarmingData({
            landTokenId: landTokenId,
            seedTokenId: seedTokenId,
            plantedAt: block.timestamp,
            harvestAt: harvestTime,
            expectedYield: expectedYield,
            isActive: true
        });

        // Track active farm lands
        playerActiveFarmLands[msg.sender].push(landTokenId);

        emit CropPlanted(msg.sender, landTokenId, seedTokenId, harvestTime, expectedYield);
    }

    /**
     * @dev Harvests a mature crop from a land plot
     * @param landTokenId The ID of the land plot
     */
    function harvestCrop(uint256 landTokenId) external nonReentrant {
        // Verify land ownership
        require(farmLand.ownerOf(landTokenId) == msg.sender, "GameManager: not land owner");

        // Get farming data
        FarmingData storage farmData = playerFarms[msg.sender][landTokenId];
        require(farmData.isActive, "GameManager: no active farming");

        // Check if harvest is ready
        require(farmLand.isReadyToHarvest(landTokenId), "GameManager: not ready to harvest");

        // Calculate yield with bonus
        uint256 baseYield = farmData.expectedYield;
        uint256 bonus = (baseYield * harvestBonus) / YIELD_MULTIPLIER_DECIMALS;
        uint256 totalYield = baseYield + bonus;

        // Unlock the land
        farmLand.unlockLand(landTokenId);

        // Clear farming data
        farmData.isActive = false;

        // Remove from active farms array
        _removeActiveFarmLand(msg.sender, landTokenId);

        // Mint FGOLD tokens to player
        farmToken.mint(msg.sender, totalYield);

        emit CropHarvested(msg.sender, landTokenId, baseYield, bonus);
    }

    /**
     * @dev Crafts an item using a recipe
     * @param recipeId The ID of the crafting recipe
     * @return tokenId The ID of the crafted NFT
     */
    function craftItem(uint256 recipeId) external nonReentrant returns (uint256) {
        require(recipeId < recipeCount, "GameManager: invalid recipe");
        CraftingRecipe storage recipe = craftingRecipes[recipeId];
        require(recipe.isActive, "GameManager: recipe not active");

        // Burn tokens for crafting
        farmToken.burnFrom(msg.sender, recipe.tokenCost);

        // Mint the crafted item
        uint256 tokenId = farmNFT.mintItem(
            msg.sender,
            recipe.resultType,
            recipe.resultRarity,
            recipe.resultPower,
            recipe.resultDurability,
            recipe.resultGrowthTime,
            recipe.resultYield,
            recipe.resultURI
        );

        emit ItemCrafted(msg.sender, recipeId, tokenId, recipe.tokenCost);

        return tokenId;
    }

    /**
     * @dev Upgrades a land plot
     * @param landTokenId The ID of the land plot to upgrade
     */
    function upgradeLand(uint256 landTokenId) external nonReentrant {
        require(farmLand.ownerOf(landTokenId) == msg.sender, "GameManager: not land owner");

        FarmLand.LandPlot memory land = farmLand.getLandPlot(landTokenId);
        require(!land.isLocked, "GameManager: land is locked");
        require(land.level < 10, "GameManager: max level reached");

        // Calculate upgrade cost (increases with level)
        uint256 upgradeCost = (land.level + 1) * 1000 * 10 ** 18; // 1000, 2000, 3000... FGOLD

        // Burn tokens for upgrade
        farmToken.burnFrom(msg.sender, upgradeCost);

        // Upgrade the land
        farmLand.upgradeLand(landTokenId);

        emit LandUpgradeRequested(msg.sender, landTokenId, upgradeCost);
    }

    /**
     * @dev Gets all active farms for a player
     * @param player The player's address
     * @return An array of FarmingData
     */
    function getPlayerActiveFarms(address player) external view returns (FarmingData[] memory) {
        uint256[] memory landIds = playerActiveFarmLands[player];
        FarmingData[] memory farms = new FarmingData[](landIds.length);

        for (uint256 i = 0; i < landIds.length; i++) {
            farms[i] = playerFarms[player][landIds[i]];
        }

        return farms;
    }

    /**
     * @dev Gets the time remaining until harvest
     * @param player The player's address
     * @param landTokenId The land plot ID
     * @return Time remaining in seconds (0 if ready)
     */
    function getTimeUntilHarvest(address player, uint256 landTokenId) external view returns (uint256) {
        FarmingData storage farmData = playerFarms[player][landTokenId];
        if (!farmData.isActive || block.timestamp >= farmData.harvestAt) {
            return 0;
        }
        return farmData.harvestAt - block.timestamp;
    }

    /**
     * @dev Sets the harvest bonus percentage
     * @param newBonus The new bonus (in percentage * 100, e.g., 1000 = 10%)
     */
    function setHarvestBonus(uint256 newBonus) external onlyOwner {
        harvestBonus = newBonus;
    }

    /**
     * @dev Updates contract references (in case of upgrades)
     * @param _farmToken New FarmToken address
     * @param _farmNFT New FarmNFT address
     * @param _farmLand New FarmLand address
     */
    function updateContracts(
        address _farmToken,
        address _farmNFT,
        address _farmLand
    ) external onlyOwner {
        if (_farmToken != address(0)) farmToken = FarmToken(_farmToken);
        if (_farmNFT != address(0)) farmNFT = FarmNFT(_farmNFT);
        if (_farmLand != address(0)) farmLand = FarmLand(_farmLand);
    }

    /**
     * @dev Internal function to remove a land ID from player's active farms
     */
    function _removeActiveFarmLand(address player, uint256 landTokenId) internal {
        uint256[] storage lands = playerActiveFarmLands[player];
        for (uint256 i = 0; i < lands.length; i++) {
            if (lands[i] == landTokenId) {
                lands[i] = lands[lands.length - 1];
                lands.pop();
                break;
            }
        }
    }
}
