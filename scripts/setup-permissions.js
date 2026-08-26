const hre = require("hardhat");

async function main() {
  console.log("Finishing contract configuration...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Using account:", deployer.address);

  // Contract addresses from deployment
  const FARM_TOKEN = "0x45bCa7f82B0D15Bd927c6cc92B9478E25a2fDdc1";
  const FARM_NFT = "0xdF980a7074fdEe748e803ecA46d896e55486004f";
  const FARM_LAND = "0x9e9f9407832dD5bcCe8e52f42d4b4D8f123cF642";
  const GAME_MANAGER = "0xaA85d4c08296c6C80f0AEbd0044A0aD5C1C7c5c5";
  const MARKETPLACE = "0x72FE19AF0A651a1dffaFf569BC0f2c9be031B8F2";

  // Get contract instances
  const farmNFT = await hre.ethers.getContractAt("FarmNFT", FARM_NFT);
  const farmLand = await hre.ethers.getContractAt("FarmLand", FARM_LAND);
  const marketplace = await hre.ethers.getContractAt("Marketplace", MARKETPLACE);

  console.log("1. Adding GameManager as FarmNFT minter...");
  try {
    const tx1 = await farmNFT.addMinter(GAME_MANAGER, { gasLimit: 100000 });
    await tx1.wait();
    console.log("   Done!");
  } catch (e) {
    console.log("   Already set or error:", e.message.slice(0, 50));
  }

  console.log("2. Adding GameManager as FarmLand operator...");
  try {
    const tx2 = await farmLand.addOperator(GAME_MANAGER, { gasLimit: 100000 });
    await tx2.wait();
    console.log("   Done!");
  } catch (e) {
    console.log("   Already set or error:", e.message.slice(0, 50));
  }

  console.log("3. Whitelisting FarmNFT in Marketplace...");
  try {
    const tx3 = await marketplace.setNFTWhitelist(FARM_NFT, true, { gasLimit: 100000 });
    await tx3.wait();
    console.log("   Done!");
  } catch (e) {
    console.log("   Already set or error:", e.message.slice(0, 50));
  }

  console.log("4. Whitelisting FarmLand in Marketplace...");
  try {
    const tx4 = await marketplace.setNFTWhitelist(FARM_LAND, true, { gasLimit: 100000 });
    await tx4.wait();
    console.log("   Done!");
  } catch (e) {
    console.log("   Already set or error:", e.message.slice(0, 50));
  }

  console.log("\nConfiguration complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
