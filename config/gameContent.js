/**
 * Canonical game content and economy parameters.
 *
 * This module is the single source of truth for deployment, seeding scripts
 * and tests. The frontend deliberately does NOT import it: it reads seed types
 * and recipes back out of `GameManager` at runtime, so what players see is
 * always what the chain will actually enforce. Only cosmetic metadata (emoji,
 * display names) lives client-side.
 *
 * Economy summary
 * ---------------
 * FAUCETS  starter pack (once per address), harvest yield
 * SINKS    seed cost, crafting cost, land upgrades, marketplace fee
 *
 * Harvest is profitable at every tier, so farming is net inflationary; the
 * quadratic land-upgrade curve is what absorbs it. See README "Economic model".
 */

const { parseEther } = require("ethers");

// Enum mirrors of FarmNFT.ItemType / FarmNFT.Rarity
const ItemType = { TOOL: 0, SEED: 1, CROP: 2, AVATAR: 3, CONSUMABLE: 4 };
const Rarity = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4 };

const ECONOMY = {
  // yieldBps = 10000 + (fertility - 50) * 20 + level * 300
  // An upgrade adds +1 level and +5 fertility, so it is worth 400 bps.
  //   fresh plot  100%-110%   |   fully upgraded plot  140%-150%
  harvestBonusBps: 0,
  fertilityBpsPerPoint: 20,
  levelBpsPerLevel: 300,
  // upgrade cost = 500 * (level+1)^2  =>  500 .. 50,000; 192,500 FGOLD to max.
  upgradeCostBase: parseEther("500"),
  // level n at 50 * n^2 XP  =>  L2 200, L3 450, L5 1250, L10 5000.
  xpPerLevel: 50n,
};

const STARTER_PACK = {
  enabled: true,
  tokens: parseEther("500"),
  landEnabled: true,
};

const LAND = {
  mintPrice: parseEther("0.005"),
};

const MARKETPLACE = {
  feeBps: 250, // 2.5%
};

/**
 * Seed tiers. `baseYield` is before the plot multiplier, so the listed margin
 * is the floor a player earns; a maxed plot earns 40% more.
 */
const SEED_TYPES = [
  {
    key: "wheat",
    name: "Wheat",
    growthTime: 300, // 5 minutes
    baseYield: parseEther("68"),
    seedCost: parseEther("50"),
    xpReward: 25n,
    requiredLevel: 1,
    rarity: Rarity.COMMON,
  },
  {
    key: "corn",
    name: "Corn",
    growthTime: 900, // 15 minutes
    baseYield: parseEther("168"),
    seedCost: parseEther("120"),
    xpReward: 60n,
    requiredLevel: 2,
    rarity: Rarity.COMMON,
  },
  {
    key: "tomato",
    name: "Tomato",
    growthTime: 3600, // 1 hour
    baseYield: parseEther("430"),
    seedCost: parseEther("300"),
    xpReward: 150n,
    requiredLevel: 3,
    rarity: Rarity.UNCOMMON,
  },
  {
    key: "golden-apple",
    name: "Golden Apple",
    growthTime: 14400, // 4 hours
    baseYield: parseEther("1180"),
    seedCost: parseEther("800"),
    xpReward: 400n,
    requiredLevel: 5,
    rarity: Rarity.LEGENDARY,
  },
];

/**
 * Crafting recipes. Tiers 2+ consume harvested CROP NFTs, which gives crops a
 * use beyond selling and turns the marketplace into part of the loop rather
 * than a side feature.
 */
const RECIPES = [
  {
    key: "basic-hoe",
    name: "Basic Hoe",
    tokenCost: parseEther("300"),
    resultType: ItemType.TOOL,
    resultRarity: Rarity.COMMON,
    resultPower: 10,
    resultDurability: 100,
    resultGrowthTime: 0,
    resultYield: 0,
    xpReward: 40n,
    requiredLevel: 1,
    materialType: ItemType.CROP,
    materialCount: 0,
  },
  {
    key: "watering-can",
    name: "Watering Can",
    tokenCost: parseEther("200"),
    resultType: ItemType.TOOL,
    resultRarity: Rarity.COMMON,
    resultPower: 5,
    resultDurability: 50,
    resultGrowthTime: 0,
    resultYield: 0,
    xpReward: 25n,
    requiredLevel: 1,
    materialType: ItemType.CROP,
    materialCount: 0,
  },
  {
    key: "fertilizer",
    name: "Fertilizer",
    tokenCost: parseEther("150"),
    resultType: ItemType.CONSUMABLE,
    resultRarity: Rarity.COMMON,
    resultPower: 10,
    resultDurability: 1,
    resultGrowthTime: 0,
    resultYield: 0,
    xpReward: 30n,
    requiredLevel: 2,
    materialType: ItemType.CROP,
    materialCount: 2,
  },
  {
    key: "steel-hoe",
    name: "Steel Hoe",
    tokenCost: parseEther("1500"),
    resultType: ItemType.TOOL,
    resultRarity: Rarity.UNCOMMON,
    resultPower: 25,
    resultDurability: 250,
    resultGrowthTime: 0,
    resultYield: 0,
    xpReward: 120n,
    requiredLevel: 3,
    materialType: ItemType.CROP,
    materialCount: 3,
  },
  {
    key: "golden-scythe",
    name: "Golden Scythe",
    tokenCost: parseEther("6000"),
    resultType: ItemType.TOOL,
    resultRarity: Rarity.EPIC,
    resultPower: 60,
    resultDurability: 600,
    resultGrowthTime: 0,
    resultYield: 0,
    xpReward: 400n,
    requiredLevel: 6,
    materialType: ItemType.CROP,
    materialCount: 5,
  },
];

/** Treasury float minted at deploy. Not a faucet - the faucet mints on demand. */
const INITIAL_TOKEN_SUPPLY = parseEther("0");

function seedURI(baseURI, key) {
  return `${baseURI}/seeds/${key}.json`;
}
function cropURI(baseURI, key) {
  return `${baseURI}/crops/${key}.json`;
}
function itemURI(baseURI, key) {
  return `${baseURI}/items/${key}.json`;
}

module.exports = {
  ItemType,
  Rarity,
  ECONOMY,
  STARTER_PACK,
  LAND,
  MARKETPLACE,
  SEED_TYPES,
  RECIPES,
  INITIAL_TOKEN_SUPPLY,
  seedURI,
  cropURI,
  itemURI,
};
