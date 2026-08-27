const hre = require("hardhat");
const {
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
} = require("../../config/gameContent");

const BASE_URI = "https://metadata.test/farm";
const MaxUint256 = (1n << 256n) - 1n;

/**
 * Deploys the full contract set, wires permissions, and seeds game content -
 * exactly the sequence `scripts/deploy.js` performs, so the tests exercise the
 * same wiring that ships.
 */
async function deployGameFixture() {
  const [owner, alice, bob, carol] = await hre.ethers.getSigners();

  const FarmToken = await hre.ethers.getContractFactory("FarmToken");
  const farmToken = await FarmToken.deploy(owner.address, INITIAL_TOKEN_SUPPLY);

  const FarmNFT = await hre.ethers.getContractFactory("FarmNFT");
  const farmNFT = await FarmNFT.deploy(owner.address, BASE_URI);

  const FarmLand = await hre.ethers.getContractFactory("FarmLand");
  const farmLand = await FarmLand.deploy(owner.address, BASE_URI, LAND.mintPrice);

  const GameManager = await hre.ethers.getContractFactory("GameManager");
  const gameManager = await GameManager.deploy(
    owner.address,
    await farmToken.getAddress(),
    await farmNFT.getAddress(),
    await farmLand.getAddress()
  );

  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(
    owner.address,
    await farmToken.getAddress(),
    MARKETPLACE.feeBps
  );

  const gameManagerAddress = await gameManager.getAddress();

  // Permissions
  await farmToken.addMinter(gameManagerAddress);
  await farmNFT.addMinter(gameManagerAddress);
  await farmLand.addOperator(gameManagerAddress);
  await marketplace.setNFTWhitelist(await farmNFT.getAddress(), true);
  await marketplace.setNFTWhitelist(await farmLand.getAddress(), true);

  // Economy
  await gameManager.setEconomyParams(
    ECONOMY.harvestBonusBps,
    ECONOMY.fertilityBpsPerPoint,
    ECONOMY.levelBpsPerLevel,
    ECONOMY.upgradeCostBase,
    ECONOMY.xpPerLevel
  );
  await gameManager.setStarterPackConfig(
    STARTER_PACK.enabled,
    STARTER_PACK.tokens,
    STARTER_PACK.landEnabled
  );

  // Content
  for (const seed of SEED_TYPES) {
    await gameManager.addSeedType(
      seed.growthTime,
      seed.baseYield,
      seed.seedCost,
      seed.xpReward,
      seed.requiredLevel,
      seed.rarity,
      seedURI(BASE_URI, seed.key),
      cropURI(BASE_URI, seed.key)
    );
  }
  for (const recipe of RECIPES) {
    await gameManager.addCraftingRecipe({
      tokenCost: recipe.tokenCost,
      resultType: recipe.resultType,
      resultRarity: recipe.resultRarity,
      resultPower: recipe.resultPower,
      resultDurability: recipe.resultDurability,
      resultGrowthTime: recipe.resultGrowthTime,
      resultYield: recipe.resultYield,
      xpReward: recipe.xpReward,
      requiredLevel: recipe.requiredLevel,
      materialType: recipe.materialType,
      materialCount: recipe.materialCount,
      resultURI: itemURI(BASE_URI, recipe.key),
    });
  }

  return {
    owner, alice, bob, carol,
    farmToken, farmNFT, farmLand, gameManager, marketplace,
    BASE_URI,
  };
}

/** Grants FGOLD by minting through the game rather than by cheating balances. */
async function fundPlayer(ctx, player, amount) {
  const { owner, farmToken } = ctx;
  await farmToken.addMinter(owner.address);
  await farmToken.connect(owner).mint(player.address, amount);
  await farmToken.removeMinter(owner.address);
}

/** Approves GameManager to burn the player's FGOLD (the real client flow). */
async function approveSpend(ctx, player, amount = MaxUint256) {
  const { farmToken, gameManager } = ctx;
  await farmToken.connect(player).approve(await gameManager.getAddress(), amount);
}

/** Onboards a player: starter pack + spend approval. Returns their land id. */
async function onboard(ctx, player) {
  const { gameManager } = ctx;
  const tx = await gameManager.connect(player).claimStarterPack();
  const receipt = await tx.wait();
  const parsed = receipt.logs
    .map((log) => {
      try { return gameManager.interface.parseLog(log); } catch { return null; }
    })
    .find((e) => e && e.name === "StarterPackClaimed");
  await approveSpend(ctx, player);
  return parsed.args.landTokenId;
}

/** Buys, plants, fast-forwards past maturity and harvests. Returns the crop id. */
async function fullCycle(ctx, player, landTokenId, seedTypeId = 0) {
  const { gameManager } = ctx;
  const seed = await gameManager.getSeedType(seedTypeId);
  const buyTx = await gameManager.connect(player).purchaseSeed(seedTypeId);
  const seedTokenId = await lastMintedNFT(ctx, player);
  await buyTx.wait();
  await gameManager.connect(player).plantCrop(landTokenId, seedTokenId);
  await advanceTime(Number(seed.growthTime) + 1);
  await gameManager.connect(player).harvestCrop(landTokenId);
  return lastMintedNFT(ctx, player);
}

async function lastMintedNFT(ctx, player) {
  const { farmNFT } = ctx;
  const balance = await farmNFT.balanceOf(player.address);
  if (balance === 0n) return 0n;
  return farmNFT.tokenOfOwnerByIndex(player.address, balance - 1n);
}

async function advanceTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

module.exports = {
  deployGameFixture,
  fundPlayer,
  approveSpend,
  onboard,
  fullCycle,
  lastMintedNFT,
  advanceTime,
  BASE_URI,
  MaxUint256,
};
