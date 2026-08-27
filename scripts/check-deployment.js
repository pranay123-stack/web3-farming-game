/**
 * Health check for a live deployment: confirms permissions are wired, content
 * is seeded, and the core loop's preconditions hold.
 *
 *   npx hardhat run scripts/check-deployment.js --network sepolia
 */
const hre = require("hardhat");
const { readDeployment } = require("./lib/deployments");

let failures = 0;

function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const { contracts } = readDeployment(chainId);

  const farmToken = await hre.ethers.getContractAt("FarmToken", contracts.FarmToken);
  const farmNFT = await hre.ethers.getContractAt("FarmNFT", contracts.FarmNFT);
  const farmLand = await hre.ethers.getContractAt("FarmLand", contracts.FarmLand);
  const gameManager = await hre.ethers.getContractAt("GameManager", contracts.GameManager);
  const marketplace = await hre.ethers.getContractAt("Marketplace", contracts.Marketplace);
  const gm = contracts.GameManager;

  console.log(`\nDeployment health check - chain ${chainId}\n`);

  console.log("Code deployed:");
  for (const [name, address] of Object.entries(contracts)) {
    const code = await hre.ethers.provider.getCode(address);
    check(name, code !== "0x", address);
  }

  console.log("\nPermissions:");
  check("GameManager mints FGOLD", await farmToken.isMinter(gm));
  check("GameManager mints FarmNFT", await farmNFT.minters(gm));
  check("GameManager operates FarmLand", await farmLand.operators(gm));
  check("Marketplace cannot mint FGOLD", !(await farmToken.isMinter(contracts.Marketplace)));
  check("Marketplace cannot mint items", !(await farmNFT.minters(contracts.Marketplace)));

  console.log("\nMarketplace whitelist:");
  check("FarmNFT tradeable", await marketplace.whitelistedNFTs(contracts.FarmNFT));
  check("FarmLand tradeable", await marketplace.whitelistedNFTs(contracts.FarmLand));

  console.log("\nGame content:");
  const seedCount = await gameManager.seedTypeCount();
  const recipeCount = await gameManager.recipeCount();
  check("seed types registered", seedCount > 0n, `${seedCount}`);
  check("recipes registered", recipeCount > 0n, `${recipeCount}`);
  check("starter pack enabled", await gameManager.starterPackEnabled());
  check("game not paused", !(await gameManager.paused()));
  check("marketplace not paused", !(await marketplace.paused()));

  console.log("\nWiring sanity:");
  check("GameManager -> FarmToken", (await gameManager.farmToken()).toLowerCase() === contracts.FarmToken.toLowerCase());
  check("GameManager -> FarmNFT", (await gameManager.farmNFT()).toLowerCase() === contracts.FarmNFT.toLowerCase());
  check("GameManager -> FarmLand", (await gameManager.farmLand()).toLowerCase() === contracts.FarmLand.toLowerCase());

  console.log(
    failures === 0
      ? "\nAll checks passed. The deployment is playable.\n"
      : `\n${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
