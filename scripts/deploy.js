/**
 * Deploys the full contract set, wires permissions, seeds game content, and
 * writes a deployment manifest that the frontend consumes.
 *
 *   npx hardhat run scripts/deploy.js --network sepolia
 *
 * Safe to point at any network. Everything it needs beyond the signer comes
 * from `config/gameContent.js`, so deployments are reproducible.
 */
const hre = require("hardhat");
const {
  ECONOMY, STARTER_PACK, LAND, MARKETPLACE,
  SEED_TYPES, RECIPES, INITIAL_TOKEN_SUPPLY,
  seedURI, cropURI, itemURI,
} = require("../config/gameContent");
const { writeDeployment } = require("./lib/deployments");

const BASE_URI = process.env.METADATA_BASE_URI || "https://raw.githubusercontent.com/pranay123-stack/web3-farming-game/main/metadata";

function log(msg) {
  console.log(msg);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  log("=".repeat(60));
  log(`Deploying to ${hre.network.name} (chainId ${chainId})`);
  log(`Deployer: ${deployer.address}`);
  log(`Balance:  ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);
  log(`Base URI: ${BASE_URI}`);
  log("=".repeat(60));

  // ---------------------------------------------------------------- deploy
  log("\n[1/4] Deploying contracts");

  const farmToken = await (await hre.ethers.getContractFactory("FarmToken"))
    .deploy(deployer.address, INITIAL_TOKEN_SUPPLY);
  await farmToken.waitForDeployment();
  log(`  FarmToken    ${await farmToken.getAddress()}`);

  const farmNFT = await (await hre.ethers.getContractFactory("FarmNFT"))
    .deploy(deployer.address, `${BASE_URI}/`);
  await farmNFT.waitForDeployment();
  log(`  FarmNFT      ${await farmNFT.getAddress()}`);

  const farmLand = await (await hre.ethers.getContractFactory("FarmLand"))
    .deploy(deployer.address, `${BASE_URI}/`, LAND.mintPrice);
  await farmLand.waitForDeployment();
  log(`  FarmLand     ${await farmLand.getAddress()}`);

  const gameManager = await (await hre.ethers.getContractFactory("GameManager")).deploy(
    deployer.address,
    await farmToken.getAddress(),
    await farmNFT.getAddress(),
    await farmLand.getAddress()
  );
  await gameManager.waitForDeployment();
  log(`  GameManager  ${await gameManager.getAddress()}`);

  const marketplace = await (await hre.ethers.getContractFactory("Marketplace"))
    .deploy(deployer.address, await farmToken.getAddress(), MARKETPLACE.feeBps);
  await marketplace.waitForDeployment();
  log(`  Marketplace  ${await marketplace.getAddress()}`);

  const gm = await gameManager.getAddress();

  // ----------------------------------------------------------- permissions
  log("\n[2/4] Wiring permissions");
  await (await farmToken.addMinter(gm)).wait();
  log("  FarmToken: GameManager is now the sole minter");
  await (await farmNFT.addMinter(gm)).wait();
  log("  FarmNFT:   GameManager is now a minter");
  await (await farmLand.addOperator(gm)).wait();
  log("  FarmLand:  GameManager is now an operator");
  await (await marketplace.setNFTWhitelist(await farmNFT.getAddress(), true)).wait();
  await (await marketplace.setNFTWhitelist(await farmLand.getAddress(), true)).wait();
  log("  Marketplace: FarmNFT and FarmLand whitelisted");

  // -------------------------------------------------------------- economy
  log("\n[3/4] Applying economy parameters and content");
  await (await gameManager.setEconomyParams(
    ECONOMY.harvestBonusBps,
    ECONOMY.fertilityBpsPerPoint,
    ECONOMY.levelBpsPerLevel,
    ECONOMY.upgradeCostBase,
    ECONOMY.xpPerLevel
  )).wait();
  await (await gameManager.setStarterPackConfig(
    STARTER_PACK.enabled, STARTER_PACK.tokens, STARTER_PACK.landEnabled
  )).wait();
  log("  Economy parameters applied");

  for (const seed of SEED_TYPES) {
    await (await gameManager.addSeedType(
      seed.growthTime, seed.baseYield, seed.seedCost, seed.xpReward,
      seed.requiredLevel, seed.rarity,
      seedURI(BASE_URI, seed.key), cropURI(BASE_URI, seed.key)
    )).wait();
    log(`  + seed ${seed.name}`);
  }
  for (const recipe of RECIPES) {
    await (await gameManager.addCraftingRecipe({
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
    })).wait();
    log(`  + recipe ${recipe.name}`);
  }

  // ------------------------------------------------------------- manifest
  log("\n[4/4] Writing deployment manifest");
  const manifest = {
    chainId,
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    baseURI: BASE_URI,
    contracts: {
      FarmToken: await farmToken.getAddress(),
      FarmNFT: await farmNFT.getAddress(),
      FarmLand: await farmLand.getAddress(),
      GameManager: gm,
      Marketplace: await marketplace.getAddress(),
    },
    config: {
      landMintPrice: LAND.mintPrice.toString(),
      marketplaceFeeBps: MARKETPLACE.feeBps,
      starterPackTokens: STARTER_PACK.tokens.toString(),
      seedTypeCount: SEED_TYPES.length,
      recipeCount: RECIPES.length,
    },
  };
  const path = writeDeployment(chainId, manifest);
  log(`  ${path}`);

  // ---------------------------------------------------------------- summary
  log("\n" + "=".repeat(60));
  log("DEPLOYMENT COMPLETE");
  log("=".repeat(60));
  console.table(manifest.contracts);
  log("\nNext steps:");
  log("  1. npm run export:abi          # push addresses + ABIs to the frontend");
  log(`  2. npx hardhat run scripts/verify.js --network ${hre.network.name}`);
  log("  3. Set NEXT_PUBLIC_CHAIN_ID in frontend/.env.local\n");

  return manifest;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });
