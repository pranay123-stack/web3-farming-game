// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./FarmToken.sol";
import "./FarmNFT.sol";
import "./FarmLand.sol";

/**
 * @title GameManager
 * @notice The rules engine. Every economically meaningful action - buying
 *         seeds, planting, harvesting, crafting, upgrading - is settled here,
 *         so the chain is the single source of truth for the game economy.
 *
 * @dev Economic model
 * -----------------
 * FGOLD enters circulation from exactly two places:
 *
 *   1. {claimStarterPack} - a one-time grant per address, so a new player can
 *      reach the core loop without needing to buy anything first. This is the
 *      only reason the game is playable at all: previously the entire supply
 *      was minted to the deployer and a new wallet had no path to its first
 *      seed.
 *   2. {harvestCrop} - yield = seedYield x yieldMultiplier(plot).
 *
 * and leaves circulation (burned, not transferred) at:
 *
 *   - {purchaseSeed}   seed cost
 *   - {craftItem}      recipe cost
 *   - {upgradeLand}    quadratic cost, the primary long-run sink
 *
 * Harvest is profitable by design - it has to be, or nobody farms - so
 * farming alone is net inflationary. Upgrade costs scale with
 * `upgradeCostBase * (level+1)^2`, which is what absorbs that emission over a
 * player's progression. All the coefficients below are storage, not
 * constants, so the curve can be retuned without redeploying.
 *
 * @dev Yield formula
 * ----------------
 *   yieldBps = BPS_DENOMINATOR
 *            + (fertility - MIN_BASE_FERTILITY) * fertilityBpsPerPoint
 *            + level * levelBpsPerLevel
 *
 * Note that an upgrade compounds through both terms: `FarmLand.upgradeLand`
 * raises `level` by 1 AND `fertility` by 5, so each level is worth
 * 300 + (5 * 20) = 400 bps. With the shipped defaults:
 *
 *   fresh plot   fertility 50-100,  level 0   ->  100% - 110%
 *   maxed plot   fertility 100-150, level 10  ->  140% - 150%
 *
 * The previous version added raw fertility (50-100) directly onto a 100 base,
 * so every plot paid 150-200% before bonuses and the loop printed money.
 */
contract GameManager is Ownable2Step, ReentrancyGuard, Pausable {
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard ceiling on the tunable harvest bonus, so the owner cannot
    ///         turn the yield multiplier into an unbounded mint.
    uint256 public constant MAX_HARVEST_BONUS_BPS = 5_000; // +50%

    /// @notice Ceiling on a recipe's material requirement, bounding loop cost.
    uint256 public constant MAX_RECIPE_MATERIALS = 10;

    FarmToken public immutable farmToken;
    FarmNFT public immutable farmNFT;
    FarmLand public immutable farmLand;

    // ------------------------------------------------------------------
    // Registries
    // ------------------------------------------------------------------

    struct SeedType {
        uint256 growthTime;     // seconds to maturity
        uint256 baseYield;      // FGOLD before the plot multiplier
        uint256 seedCost;       // FGOLD burned to buy one
        uint256 xpReward;       // XP granted on harvest
        uint32 requiredLevel;   // player level gate
        FarmNFT.Rarity rarity;  // rarity of the seed and its crop
        string seedURI;
        string cropURI;
        bool isActive;
    }

    struct CraftingRecipe {
        uint256 tokenCost;
        FarmNFT.ItemType resultType;
        FarmNFT.Rarity resultRarity;
        uint256 resultPower;
        uint256 resultDurability;
        uint256 resultGrowthTime;
        uint256 resultYield;
        uint256 xpReward;
        uint32 requiredLevel;
        // Optional NFT inputs. When materialCount > 0 the caller must supply
        // exactly that many owned tokens of `materialType`, which are burned.
        FarmNFT.ItemType materialType;
        uint8 materialCount;
        string resultURI;
        bool isActive;
    }

    struct FarmingData {
        uint256 landTokenId;
        uint256 seedTypeId;
        uint256 seedTokenId;
        uint256 plantedAt;
        uint256 harvestAt;
        uint256 expectedYield;  // locked in at plant time
        bool isActive;
    }

    struct PlayerProfile {
        uint256 xp;
        uint32 totalHarvests;
        uint32 totalPlanted;
        uint32 totalCrafted;
        uint32 totalUpgrades;
        bool hasClaimedStarterPack;
    }

    mapping(uint256 => SeedType) public seedTypes;
    uint256 public seedTypeCount;

    mapping(uint256 => CraftingRecipe) public craftingRecipes;
    uint256 public recipeCount;

    mapping(address => mapping(uint256 => FarmingData)) public playerFarms;
    mapping(address => uint256[]) private _playerActiveFarmLands;
    /// @dev landTokenId => index+1 inside `_playerActiveFarmLands[player]`.
    ///      Makes removal O(1) instead of a linear scan.
    mapping(address => mapping(uint256 => uint256)) private _activeFarmIndex;

    mapping(address => PlayerProfile) public playerProfiles;

    // ------------------------------------------------------------------
    // Tunable economy parameters
    // ------------------------------------------------------------------

    uint256 public harvestBonusBps = 0;
    uint256 public fertilityBpsPerPoint = 20;   // +0.2% per fertility point over the floor
    uint256 public levelBpsPerLevel = 300;      // +3% per plot upgrade level
    uint256 public upgradeCostBase = 500 ether; // cost = base * (level+1)^2
    uint256 public xpPerLevel = 100;            // level n requires xpPerLevel * n^2

    uint256 public starterPackTokens = 500 ether;
    bool public starterPackLandEnabled = true;
    bool public starterPackEnabled = true;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event StarterPackClaimed(address indexed player, uint256 tokenAmount, uint256 landTokenId);
    event SeedPurchased(address indexed player, uint256 indexed seedTypeId, uint256 tokenId, uint256 cost);
    event CropPlanted(
        address indexed player,
        uint256 indexed landTokenId,
        uint256 indexed seedTypeId,
        uint256 seedTokenId,
        uint256 harvestAt,
        uint256 expectedYield
    );
    event CropHarvested(
        address indexed player,
        uint256 indexed landTokenId,
        uint256 indexed seedTypeId,
        uint256 yieldAmount,
        uint256 bonusAmount,
        uint256 cropTokenId,
        uint256 xpGained
    );
    event ItemCrafted(address indexed player, uint256 indexed recipeId, uint256 tokenId, uint256 tokenCost);
    event LandUpgraded(address indexed player, uint256 indexed landTokenId, uint256 newLevel, uint256 cost);
    event PlayerLeveledUp(address indexed player, uint32 newLevel, uint256 totalXp);
    event SeedTypeAdded(uint256 indexed seedTypeId, uint256 growthTime, uint256 baseYield, uint256 seedCost);
    event SeedTypeUpdated(uint256 indexed seedTypeId, uint256 seedCost, bool isActive);
    event RecipeAdded(uint256 indexed recipeId, uint256 tokenCost, FarmNFT.ItemType resultType);
    event RecipeUpdated(uint256 indexed recipeId, uint256 tokenCost, bool isActive);
    event EconomyParamsUpdated(
        uint256 harvestBonusBps,
        uint256 fertilityBpsPerPoint,
        uint256 levelBpsPerLevel,
        uint256 upgradeCostBase,
        uint256 xpPerLevel
    );
    event StarterPackConfigUpdated(bool enabled, uint256 tokenAmount, bool landEnabled);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error ZeroAddress();
    error InvalidSeedType(uint256 seedTypeId);
    error SeedTypeInactive(uint256 seedTypeId);
    error InvalidRecipe(uint256 recipeId);
    error RecipeInactive(uint256 recipeId);
    error NotLandOwner(uint256 landTokenId, address caller);
    error NotSeedOwner(uint256 seedTokenId, address caller);
    error LandInUse(uint256 landTokenId);
    error NotASeed(uint256 seedTokenId);
    error NoActiveFarm(uint256 landTokenId);
    error NotReadyToHarvest(uint256 landTokenId, uint256 readyAt);
    error LevelTooLow(uint32 required, uint32 actual);
    error StarterPackDisabled();
    error StarterPackAlreadyClaimed(address player);
    error MaxLevelReached(uint256 landTokenId);
    error HarvestBonusTooHigh(uint256 requested, uint256 maximum);
    error WrongMaterialCount(uint256 expected, uint256 provided);
    error WrongMaterialType(uint256 tokenId);
    error DuplicateMaterial(uint256 tokenId);
    error TooManyMaterials(uint256 count, uint256 maximum);
    error InvalidParameter();

    constructor(
        address initialOwner,
        address _farmToken,
        address _farmNFT,
        address _farmLand
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) ||
            _farmToken == address(0) ||
            _farmNFT == address(0) ||
            _farmLand == address(0)
        ) revert ZeroAddress();

        // Immutable: the previous version let the owner hot-swap the token,
        // NFT and land contracts at will, which meant a player's entire
        // balance could be invalidated by one admin transaction.
        farmToken = FarmToken(_farmToken);
        farmNFT = FarmNFT(_farmNFT);
        farmLand = FarmLand(_farmLand);
    }

    // ==================================================================
    // Player onboarding
    // ==================================================================

    /**
     * @notice One-time grant of starting FGOLD and a free plot.
     * @dev The entry point into the core loop. Sybil-farmable by design on a
     *      public testnet; that trade-off is accepted so anyone can play
     *      without being airdropped tokens by hand, and it is disableable via
     *      {setStarterPackConfig} before any mainnet deployment.
     */
    function claimStarterPack() external nonReentrant whenNotPaused returns (uint256 landTokenId) {
        if (!starterPackEnabled) revert StarterPackDisabled();

        PlayerProfile storage profile = playerProfiles[msg.sender];
        if (profile.hasClaimedStarterPack) revert StarterPackAlreadyClaimed(msg.sender);
        profile.hasClaimedStarterPack = true;

        if (starterPackLandEnabled) {
            landTokenId = farmLand.mintLandAutoFor(msg.sender);
        }
        if (starterPackTokens > 0) {
            farmToken.mint(msg.sender, starterPackTokens);
        }

        emit StarterPackClaimed(msg.sender, starterPackTokens, landTokenId);
    }

    // ==================================================================
    // Core loop
    // ==================================================================

    /**
     * @notice Burns FGOLD for a seed NFT of `seedTypeId`.
     * @dev Requires an ERC-20 allowance for this contract (or a permit).
     */
    function purchaseSeed(uint256 seedTypeId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        SeedType storage seed = _requireActiveSeed(seedTypeId);
        _requireLevel(msg.sender, seed.requiredLevel);

        farmToken.burnFrom(msg.sender, seed.seedCost);

        tokenId = farmNFT.mintSeed(
            msg.sender,
            seed.rarity,
            seed.growthTime,
            seed.baseYield,
            seedTypeId,
            seed.seedURI
        );

        emit SeedPurchased(msg.sender, seedTypeId, tokenId, seed.seedCost);
    }

    /// @notice Plants an owned seed on an owned, idle plot.
    function plantCrop(uint256 landTokenId, uint256 seedTokenId)
        external
        nonReentrant
        whenNotPaused
    {
        if (farmLand.ownerOf(landTokenId) != msg.sender) revert NotLandOwner(landTokenId, msg.sender);
        if (farmNFT.ownerOf(seedTokenId) != msg.sender) revert NotSeedOwner(seedTokenId, msg.sender);

        FarmLand.LandPlot memory plot = farmLand.getLandPlot(landTokenId);
        if (plot.isLocked) revert LandInUse(landTokenId);

        // Defence in depth: the plot cannot be locked while a farm record is
        // active, but an operator-level unlock would otherwise let a second
        // plant orphan the first record.
        if (playerFarms[msg.sender][landTokenId].isActive) revert LandInUse(landTokenId);

        FarmNFT.Item memory seed = farmNFT.getItem(seedTokenId);
        if (seed.itemType != FarmNFT.ItemType.SEED) revert NotASeed(seedTokenId);

        uint256 expectedYield = (seed.yieldAmount * yieldMultiplierBps(plot.fertility, plot.level)) / BPS_DENOMINATOR;
        uint256 harvestAt = block.timestamp + seed.growthTime;

        playerFarms[msg.sender][landTokenId] = FarmingData({
            landTokenId: landTokenId,
            seedTypeId: seed.seedTypeId,
            seedTokenId: seedTokenId,
            plantedAt: block.timestamp,
            harvestAt: harvestAt,
            expectedYield: expectedYield,
            isActive: true
        });
        _addActiveFarm(msg.sender, landTokenId);

        PlayerProfile storage profile = playerProfiles[msg.sender];
        profile.totalPlanted += 1;

        // External calls last: state is fully settled before any hook runs.
        farmLand.lockLand(landTokenId, seed.growthTime, seedTokenId);
        farmNFT.gameBurn(seedTokenId, msg.sender);

        emit CropPlanted(msg.sender, landTokenId, seed.seedTypeId, seedTokenId, harvestAt, expectedYield);
    }

    /**
     * @notice Harvests a mature crop: mints the FGOLD yield, a crop NFT, and XP.
     * @dev The reward was fixed at plant time and is re-derived from storage,
     *      never from calldata. Maturity is decided by the plot's `lockedUntil`
     *      timestamp, which only this contract can set.
     */
    function harvestCrop(uint256 landTokenId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 cropTokenId)
    {
        if (farmLand.ownerOf(landTokenId) != msg.sender) revert NotLandOwner(landTokenId, msg.sender);

        FarmingData storage farmData = playerFarms[msg.sender][landTokenId];
        if (!farmData.isActive) revert NoActiveFarm(landTokenId);
        if (block.timestamp < farmData.harvestAt) {
            revert NotReadyToHarvest(landTokenId, farmData.harvestAt);
        }

        uint256 baseYield = farmData.expectedYield;
        uint256 bonus = (baseYield * harvestBonusBps) / BPS_DENOMINATOR;
        uint256 totalYield = baseYield + bonus;
        uint256 seedTypeId = farmData.seedTypeId;

        // Clear farm state before minting anything, so the ERC-721 receiver
        // hook fired by the crop mint cannot observe a harvestable plot.
        farmData.isActive = false;
        _removeActiveFarm(msg.sender, landTokenId);

        PlayerProfile storage profile = playerProfiles[msg.sender];
        profile.totalHarvests += 1;

        uint256 xpGained;
        SeedType storage seed = seedTypes[seedTypeId];
        if (seedTypeId < seedTypeCount) {
            xpGained = seed.xpReward;
        }
        if (xpGained > 0) {
            _grantXp(msg.sender, profile, xpGained);
        }

        farmLand.unlockLand(landTokenId);

        if (totalYield > 0) {
            farmToken.mint(msg.sender, totalYield);
        }

        // The harvested crop is a real, tradeable NFT. Previously `cropURI`
        // was configured but nothing ever minted a crop, so the marketplace
        // had almost nothing to trade.
        if (seedTypeId < seedTypeCount) {
            cropTokenId = farmNFT.mintCrop(msg.sender, seed.rarity, totalYield, seedTypeId, seed.cropURI);
        }

        emit CropHarvested(msg.sender, landTokenId, seedTypeId, baseYield, bonus, cropTokenId, xpGained);
    }

    /**
     * @notice Crafts an item, burning FGOLD and any material NFTs the recipe requires.
     * @param materialTokenIds Tokens to consume. Must be exactly
     *        `recipe.materialCount` distinct tokens of `recipe.materialType`
     *        owned by the caller. Burning them is what prevents the same
     *        materials satisfying two crafts.
     */
    function craftItem(uint256 recipeId, uint256[] calldata materialTokenIds)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (recipeId >= recipeCount) revert InvalidRecipe(recipeId);
        CraftingRecipe storage recipe = craftingRecipes[recipeId];
        if (!recipe.isActive) revert RecipeInactive(recipeId);
        _requireLevel(msg.sender, recipe.requiredLevel);

        if (materialTokenIds.length != recipe.materialCount) {
            revert WrongMaterialCount(recipe.materialCount, materialTokenIds.length);
        }

        // Validate the whole material set before burning any of it.
        for (uint256 i = 0; i < materialTokenIds.length; i++) {
            uint256 materialId = materialTokenIds[i];
            for (uint256 j = 0; j < i; j++) {
                if (materialTokenIds[j] == materialId) revert DuplicateMaterial(materialId);
            }
            if (farmNFT.ownerOf(materialId) != msg.sender) revert NotSeedOwner(materialId, msg.sender);
            if (farmNFT.getItem(materialId).itemType != recipe.materialType) {
                revert WrongMaterialType(materialId);
            }
        }

        if (recipe.tokenCost > 0) {
            farmToken.burnFrom(msg.sender, recipe.tokenCost);
        }
        for (uint256 i = 0; i < materialTokenIds.length; i++) {
            farmNFT.gameBurn(materialTokenIds[i], msg.sender);
        }

        PlayerProfile storage profile = playerProfiles[msg.sender];
        profile.totalCrafted += 1;
        if (recipe.xpReward > 0) {
            _grantXp(msg.sender, profile, recipe.xpReward);
        }

        tokenId = farmNFT.mintItem(
            msg.sender,
            recipe.resultType,
            recipe.resultRarity,
            recipe.resultPower,
            recipe.resultDurability,
            recipe.resultGrowthTime,
            recipe.resultYield,
            0,
            recipe.resultURI
        );

        emit ItemCrafted(msg.sender, recipeId, tokenId, recipe.tokenCost);
    }

    /// @notice Burns FGOLD to raise a plot's level, permanently improving its yield.
    function upgradeLand(uint256 landTokenId) external nonReentrant whenNotPaused {
        if (farmLand.ownerOf(landTokenId) != msg.sender) revert NotLandOwner(landTokenId, msg.sender);

        FarmLand.LandPlot memory plot = farmLand.getLandPlot(landTokenId);
        if (plot.isLocked) revert LandInUse(landTokenId);
        if (plot.level >= farmLand.MAX_LEVEL()) revert MaxLevelReached(landTokenId);

        uint256 cost = getUpgradeCost(plot.level);
        farmToken.burnFrom(msg.sender, cost);

        PlayerProfile storage profile = playerProfiles[msg.sender];
        profile.totalUpgrades += 1;

        farmLand.upgradeLand(landTokenId);

        emit LandUpgraded(msg.sender, landTokenId, plot.level + 1, cost);
    }

    // ==================================================================
    // Progression
    // ==================================================================

    function _grantXp(address player, PlayerProfile storage profile, uint256 amount) internal {
        uint32 levelBefore = _levelForXp(profile.xp);
        profile.xp += amount;
        uint32 levelAfter = _levelForXp(profile.xp);
        if (levelAfter > levelBefore) {
            emit PlayerLeveledUp(player, levelAfter, profile.xp);
        }
    }

    /// @dev level n is reached at `xpPerLevel * n^2` total XP. Derived rather
    ///      than stored, so it can never drift out of sync with `xp`.
    function _levelForXp(uint256 xp) internal view returns (uint32) {
        uint256 unit = xpPerLevel;
        if (unit == 0) return 1;
        uint256 n = 1;
        while ((n + 1) * (n + 1) * unit <= xp && n < 100) {
            n++;
        }
        return uint32(n);
    }

    function getPlayerLevel(address player) public view returns (uint32) {
        return _levelForXp(playerProfiles[player].xp);
    }

    function xpRequiredForLevel(uint32 level) public view returns (uint256) {
        if (level <= 1) return 0;
        return xpPerLevel * uint256(level) * uint256(level);
    }

    function _requireLevel(address player, uint32 required) internal view {
        if (required <= 1) return;
        uint32 actual = getPlayerLevel(player);
        if (actual < required) revert LevelTooLow(required, actual);
    }

    // ==================================================================
    // Views
    // ==================================================================

    /// @notice Yield multiplier in basis points for a plot's fertility/level.
    function yieldMultiplierBps(uint256 fertility, uint256 level) public view returns (uint256) {
        uint256 floorFertility = farmLand.MIN_BASE_FERTILITY();
        uint256 fertilityBonus = fertility > floorFertility
            ? (fertility - floorFertility) * fertilityBpsPerPoint
            : 0;
        return BPS_DENOMINATOR + fertilityBonus + (level * levelBpsPerLevel);
    }

    /// @notice FGOLD cost to upgrade a plot that is currently at `currentLevel`.
    function getUpgradeCost(uint256 currentLevel) public view returns (uint256) {
        uint256 next = currentLevel + 1;
        return upgradeCostBase * next * next;
    }

    function getPlayerProfile(address player)
        external
        view
        returns (
            uint256 xp,
            uint32 level,
            uint256 xpForNextLevel,
            uint32 totalHarvests,
            uint32 totalPlanted,
            uint32 totalCrafted,
            uint32 totalUpgrades,
            bool hasClaimedStarterPack
        )
    {
        PlayerProfile storage p = playerProfiles[player];
        level = _levelForXp(p.xp);
        return (
            p.xp,
            level,
            xpRequiredForLevel(level + 1),
            p.totalHarvests,
            p.totalPlanted,
            p.totalCrafted,
            p.totalUpgrades,
            p.hasClaimedStarterPack
        );
    }

    function getPlayerActiveFarms(address player)
        external
        view
        returns (FarmingData[] memory farms)
    {
        uint256[] storage landIds = _playerActiveFarmLands[player];
        farms = new FarmingData[](landIds.length);
        for (uint256 i = 0; i < landIds.length; i++) {
            farms[i] = playerFarms[player][landIds[i]];
        }
    }

    function getActiveFarmCount(address player) external view returns (uint256) {
        return _playerActiveFarmLands[player].length;
    }

    function getTimeUntilHarvest(address player, uint256 landTokenId) external view returns (uint256) {
        FarmingData storage farmData = playerFarms[player][landTokenId];
        if (!farmData.isActive || block.timestamp >= farmData.harvestAt) return 0;
        return farmData.harvestAt - block.timestamp;
    }

    function getSeedType(uint256 seedTypeId) external view returns (SeedType memory) {
        if (seedTypeId >= seedTypeCount) revert InvalidSeedType(seedTypeId);
        return seedTypes[seedTypeId];
    }

    function getAllSeedTypes() external view returns (SeedType[] memory all) {
        all = new SeedType[](seedTypeCount);
        for (uint256 i = 0; i < seedTypeCount; i++) {
            all[i] = seedTypes[i];
        }
    }

    function getRecipe(uint256 recipeId) external view returns (CraftingRecipe memory) {
        if (recipeId >= recipeCount) revert InvalidRecipe(recipeId);
        return craftingRecipes[recipeId];
    }

    function getAllRecipes() external view returns (CraftingRecipe[] memory all) {
        all = new CraftingRecipe[](recipeCount);
        for (uint256 i = 0; i < recipeCount; i++) {
            all[i] = craftingRecipes[i];
        }
    }

    // ==================================================================
    // Admin - content registries
    // ==================================================================

    function addSeedType(
        uint256 growthTime,
        uint256 baseYield,
        uint256 seedCost,
        uint256 xpReward,
        uint32 requiredLevel,
        FarmNFT.Rarity rarity,
        string calldata seedURI,
        string calldata cropURI
    ) external onlyOwner returns (uint256 seedTypeId) {
        if (growthTime == 0) revert InvalidParameter();
        seedTypeId = seedTypeCount++;
        seedTypes[seedTypeId] = SeedType({
            growthTime: growthTime,
            baseYield: baseYield,
            seedCost: seedCost,
            xpReward: xpReward,
            requiredLevel: requiredLevel,
            rarity: rarity,
            seedURI: seedURI,
            cropURI: cropURI,
            isActive: true
        });
        emit SeedTypeAdded(seedTypeId, growthTime, baseYield, seedCost);
    }

    function updateSeedType(
        uint256 seedTypeId,
        uint256 seedCost,
        uint256 baseYield,
        uint32 requiredLevel,
        bool isActive
    ) external onlyOwner {
        if (seedTypeId >= seedTypeCount) revert InvalidSeedType(seedTypeId);
        SeedType storage seed = seedTypes[seedTypeId];
        seed.seedCost = seedCost;
        seed.baseYield = baseYield;
        seed.requiredLevel = requiredLevel;
        seed.isActive = isActive;
        emit SeedTypeUpdated(seedTypeId, seedCost, isActive);
    }

    struct RecipeInput {
        uint256 tokenCost;
        FarmNFT.ItemType resultType;
        FarmNFT.Rarity resultRarity;
        uint256 resultPower;
        uint256 resultDurability;
        uint256 resultGrowthTime;
        uint256 resultYield;
        uint256 xpReward;
        uint32 requiredLevel;
        FarmNFT.ItemType materialType;
        uint8 materialCount;
        string resultURI;
    }

    function addCraftingRecipe(RecipeInput calldata input) external onlyOwner returns (uint256 recipeId) {
        if (input.materialCount > MAX_RECIPE_MATERIALS) {
            revert TooManyMaterials(input.materialCount, MAX_RECIPE_MATERIALS);
        }
        recipeId = recipeCount++;
        craftingRecipes[recipeId] = CraftingRecipe({
            tokenCost: input.tokenCost,
            resultType: input.resultType,
            resultRarity: input.resultRarity,
            resultPower: input.resultPower,
            resultDurability: input.resultDurability,
            resultGrowthTime: input.resultGrowthTime,
            resultYield: input.resultYield,
            xpReward: input.xpReward,
            requiredLevel: input.requiredLevel,
            materialType: input.materialType,
            materialCount: input.materialCount,
            resultURI: input.resultURI,
            isActive: true
        });
        emit RecipeAdded(recipeId, input.tokenCost, input.resultType);
    }

    function updateCraftingRecipe(
        uint256 recipeId,
        uint256 tokenCost,
        uint32 requiredLevel,
        bool isActive
    ) external onlyOwner {
        if (recipeId >= recipeCount) revert InvalidRecipe(recipeId);
        CraftingRecipe storage recipe = craftingRecipes[recipeId];
        recipe.tokenCost = tokenCost;
        recipe.requiredLevel = requiredLevel;
        recipe.isActive = isActive;
        emit RecipeUpdated(recipeId, tokenCost, isActive);
    }

    // ==================================================================
    // Admin - economy tuning
    // ==================================================================

    function setEconomyParams(
        uint256 _harvestBonusBps,
        uint256 _fertilityBpsPerPoint,
        uint256 _levelBpsPerLevel,
        uint256 _upgradeCostBase,
        uint256 _xpPerLevel
    ) external onlyOwner {
        if (_harvestBonusBps > MAX_HARVEST_BONUS_BPS) {
            revert HarvestBonusTooHigh(_harvestBonusBps, MAX_HARVEST_BONUS_BPS);
        }
        if (_xpPerLevel == 0) revert InvalidParameter();
        harvestBonusBps = _harvestBonusBps;
        fertilityBpsPerPoint = _fertilityBpsPerPoint;
        levelBpsPerLevel = _levelBpsPerLevel;
        upgradeCostBase = _upgradeCostBase;
        xpPerLevel = _xpPerLevel;
        emit EconomyParamsUpdated(
            _harvestBonusBps,
            _fertilityBpsPerPoint,
            _levelBpsPerLevel,
            _upgradeCostBase,
            _xpPerLevel
        );
    }

    function setStarterPackConfig(bool enabled, uint256 tokenAmount, bool landEnabled) external onlyOwner {
        starterPackEnabled = enabled;
        starterPackTokens = tokenAmount;
        starterPackLandEnabled = landEnabled;
        emit StarterPackConfigUpdated(enabled, tokenAmount, landEnabled);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ==================================================================
    // Internal helpers
    // ==================================================================

    function _requireActiveSeed(uint256 seedTypeId) internal view returns (SeedType storage seed) {
        if (seedTypeId >= seedTypeCount) revert InvalidSeedType(seedTypeId);
        seed = seedTypes[seedTypeId];
        if (!seed.isActive) revert SeedTypeInactive(seedTypeId);
    }

    function _addActiveFarm(address player, uint256 landTokenId) internal {
        if (_activeFarmIndex[player][landTokenId] != 0) return;
        _playerActiveFarmLands[player].push(landTokenId);
        _activeFarmIndex[player][landTokenId] = _playerActiveFarmLands[player].length;
    }

    /// @dev O(1) swap-and-pop using the index side-table.
    function _removeActiveFarm(address player, uint256 landTokenId) internal {
        uint256 indexPlusOne = _activeFarmIndex[player][landTokenId];
        if (indexPlusOne == 0) return;

        uint256[] storage lands = _playerActiveFarmLands[player];
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = lands.length - 1;

        if (index != lastIndex) {
            uint256 movedLand = lands[lastIndex];
            lands[index] = movedLand;
            _activeFarmIndex[player][movedLand] = index + 1;
        }
        lands.pop();
        delete _activeFarmIndex[player][landTokenId];
    }
}
