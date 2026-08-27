/**
 * Verifies every deployed contract on the block explorer using the manifest
 * written by scripts/deploy.js.
 *
 *   npx hardhat run scripts/verify.js --network sepolia
 */
const hre = require("hardhat");
const { readDeployment } = require("./lib/deployments");
const { LAND, MARKETPLACE, INITIAL_TOKEN_SUPPLY } = require("../config/gameContent");

async function verify(address, constructorArguments) {
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`  verified ${address}`);
  } catch (error) {
    const message = String(error.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log(`  already verified ${address}`);
    } else {
      console.error(`  FAILED ${address}: ${message.split("\n")[0]}`);
    }
  }
}

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const deployment = readDeployment(chainId);
  const { contracts, deployer, baseURI } = deployment;

  console.log(`Verifying contracts on ${hre.network.name} (chain ${chainId})\n`);

  await verify(contracts.FarmToken, [deployer, INITIAL_TOKEN_SUPPLY]);
  await verify(contracts.FarmNFT, [deployer, `${baseURI}/`]);
  await verify(contracts.FarmLand, [deployer, `${baseURI}/`, LAND.mintPrice]);
  await verify(contracts.GameManager, [
    deployer, contracts.FarmToken, contracts.FarmNFT, contracts.FarmLand,
  ]);
  await verify(contracts.Marketplace, [deployer, contracts.FarmToken, MARKETPLACE.feeBps]);

  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
