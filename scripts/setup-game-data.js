const hre = require("hardhat");

async function main() {
  console.log("Setting up game data...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Using account:", deployer.address);

  const GAME_MANAGER = "0xaA85d4c08296c6C80f0AEbd0044A0aD5C1C7c5c5";
  const BASE_URI = "https://api.farmgame.example.com/metadata";

  const gameManager = await hre.ethers.getContractAt("GameManager", GAME_MANAGER);

  console.log("Adding seed types...");

  // Wheat seed
  try {
    console.log("  Adding Wheat...");
    const tx1 = await gameManager.addSeedType(
      3600,
      hre.ethers.parseEther("100"),
      hre.ethers.parseEther("50"),
      `${BASE_URI}/seeds/wheat.json`,
      `${BASE_URI}/crops/wheat.json`,
      { gasLimit: 200000 }
    );
    await tx1.wait();
    console.log("  Wheat added!");
  } catch (e) {
    console.log("  Wheat error:", e.message.slice(0, 50));
  }

  // Corn seed
  try {
    console.log("  Adding Corn...");
    const tx2 = await gameManager.addSeedType(
      7200,
      hre.ethers.parseEther("250"),
      hre.ethers.parseEther("100"),
      `${BASE_URI}/seeds/corn.json`,
      `${BASE_URI}/crops/corn.json`,
      { gasLimit: 200000 }
    );
    await tx2.wait();
    console.log("  Corn added!");
  } catch (e) {
    console.log("  Corn error:", e.message.slice(0, 50));
  }

  // Tomato seed
  try {
    console.log("  Adding Tomato...");
    const tx3 = await gameManager.addSeedType(
      14400,
      hre.ethers.parseEther("600"),
      hre.ethers.parseEther("200"),
      `${BASE_URI}/seeds/tomato.json`,
      `${BASE_URI}/crops/tomato.json`,
      { gasLimit: 200000 }
    );
    await tx3.wait();
    console.log("  Tomato added!");
  } catch (e) {
    console.log("  Tomato error:", e.message.slice(0, 50));
  }

  console.log("\nGame data setup complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
