const hre = require("hardhat");

async function main() {
  console.log("Starting deployment of GameFi Farming contracts...\n");

  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  // Configuration
  const BASE_URI = "https://api.farmgame.example.com/metadata"; // Replace with actual URI
  const LAND_MINT_PRICE = hre.ethers.parseEther("0.01"); // 0.01 ETH per land plot
  const MARKETPLACE_FEE = 250; // 2.5% fee

  // ============================================
  // Deploy FarmToken (FGOLD)
  // ============================================
  console.log("1. Deploying FarmToken (FGOLD)...");
  const FarmToken = await hre.ethers.getContractFactory("FarmToken");
  const farmToken = await FarmToken.deploy(deployer.address);
  await farmToken.waitForDeployment();
  const farmTokenAddress = await farmToken.getAddress();
  console.log("   FarmToken deployed to:", farmTokenAddress);

  // ============================================
  // Deploy FarmNFT (FITEM)
  // ============================================
  console.log("2. Deploying FarmNFT (FITEM)...");
  const FarmNFT = await hre.ethers.getContractFactory("FarmNFT");
  const farmNFT = await FarmNFT.deploy(deployer.address, BASE_URI);
  await farmNFT.waitForDeployment();
  const farmNFTAddress = await farmNFT.getAddress();
  console.log("   FarmNFT deployed to:", farmNFTAddress);

  // ============================================
  // Deploy FarmLand (FLAND)
  // ============================================
  console.log("3. Deploying FarmLand (FLAND)...");
  const FarmLand = await hre.ethers.getContractFactory("FarmLand");
  const farmLand = await FarmLand.deploy(deployer.address, BASE_URI, LAND_MINT_PRICE);
  await farmLand.waitForDeployment();
  const farmLandAddress = await farmLand.getAddress();
  console.log("   FarmLand deployed to:", farmLandAddress);

  // ============================================
  // Deploy GameManager
  // ============================================
  console.log("4. Deploying GameManager...");
  const GameManager = await hre.ethers.getContractFactory("GameManager");
  const gameManager = await GameManager.deploy(
    deployer.address,
    farmTokenAddress,
    farmNFTAddress,
    farmLandAddress
  );
  await gameManager.waitForDeployment();
  const gameManagerAddress = await gameManager.getAddress();
  console.log("   GameManager deployed to:", gameManagerAddress);

  // ============================================
  // Deploy Marketplace
  // ============================================
  console.log("5. Deploying Marketplace...");
  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(
    deployer.address,
    farmTokenAddress,
    MARKETPLACE_FEE
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("   Marketplace deployed to:", marketplaceAddress);

  // ============================================
  // Configure Permissions
  // ============================================
  console.log("\n6. Configuring permissions...");

  // Add GameManager as minter for FarmToken
  console.log("   - Adding GameManager as FarmToken minter...");
  await farmToken.addMinter(gameManagerAddress);

  // Add GameManager as minter for FarmNFT
  console.log("   - Adding GameManager as FarmNFT minter...");
  await farmNFT.addMinter(gameManagerAddress);

  // Add GameManager as operator for FarmLand
  console.log("   - Adding GameManager as FarmLand operator...");
  await farmLand.addOperator(gameManagerAddress);

  // Whitelist NFT contracts in Marketplace
  console.log("   - Whitelisting FarmNFT in Marketplace...");
  await marketplace.setNFTWhitelist(farmNFTAddress, true);
  console.log("   - Whitelisting FarmLand in Marketplace...");
  await marketplace.setNFTWhitelist(farmLandAddress, true);

  // ============================================
  // Setup Initial Game Data
  // ============================================
  console.log("\n7. Setting up initial game data...");

  // Add seed types
  console.log("   - Adding seed types...");

  // Wheat seed: 1 hour growth, 100 FGOLD yield, 50 FGOLD cost
  await gameManager.addSeedType(
    3600, // 1 hour
    hre.ethers.parseEther("100"), // 100 FGOLD yield
    hre.ethers.parseEther("50"), // 50 FGOLD cost
    `${BASE_URI}/seeds/wheat.json`,
    `${BASE_URI}/crops/wheat.json`
  );
  console.log("     + Wheat seed added");

  // Corn seed: 2 hours growth, 250 FGOLD yield, 100 FGOLD cost
  await gameManager.addSeedType(
    7200, // 2 hours
    hre.ethers.parseEther("250"),
    hre.ethers.parseEther("100"),
    `${BASE_URI}/seeds/corn.json`,
    `${BASE_URI}/crops/corn.json`
  );
  console.log("     + Corn seed added");

  // Tomato seed: 4 hours growth, 600 FGOLD yield, 200 FGOLD cost
  await gameManager.addSeedType(
    14400, // 4 hours
    hre.ethers.parseEther("600"),
    hre.ethers.parseEther("200"),
    `${BASE_URI}/seeds/tomato.json`,
    `${BASE_URI}/crops/tomato.json`
  );
  console.log("     + Tomato seed added");

  // Golden Apple seed: 8 hours growth, 1500 FGOLD yield, 500 FGOLD cost
  await gameManager.addSeedType(
    28800, // 8 hours
    hre.ethers.parseEther("1500"),
    hre.ethers.parseEther("500"),
    `${BASE_URI}/seeds/golden-apple.json`,
    `${BASE_URI}/crops/golden-apple.json`
  );
  console.log("     + Golden Apple seed added");

  // Add crafting recipes
  console.log("   - Adding crafting recipes...");

  // Basic Hoe: 500 FGOLD, Tool, Common, Power 10, Durability 100
  await gameManager.addCraftingRecipe(
    hre.ethers.parseEther("500"),
    0, // TOOL
    0, // COMMON
    10, // power
    100, // durability
    0, // growthTime (not applicable)
    0, // yield (not applicable)
    `${BASE_URI}/tools/basic-hoe.json`
  );
  console.log("     + Basic Hoe recipe added");

  // Steel Hoe: 2000 FGOLD, Tool, Uncommon, Power 25, Durability 250
  await gameManager.addCraftingRecipe(
    hre.ethers.parseEther("2000"),
    0, // TOOL
    1, // UNCOMMON
    25,
    250,
    0,
    0,
    `${BASE_URI}/tools/steel-hoe.json`
  );
  console.log("     + Steel Hoe recipe added");

  // Watering Can: 300 FGOLD, Tool, Common, Power 5, Durability 50
  await gameManager.addCraftingRecipe(
    hre.ethers.parseEther("300"),
    0, // TOOL
    0, // COMMON
    5,
    50,
    0,
    0,
    `${BASE_URI}/tools/watering-can.json`
  );
  console.log("     + Watering Can recipe added");

  // Fertilizer: 100 FGOLD, Consumable, Common
  await gameManager.addCraftingRecipe(
    hre.ethers.parseEther("100"),
    4, // CONSUMABLE
    0, // COMMON
    10, // boost power
    1, // single use
    0,
    0,
    `${BASE_URI}/consumables/fertilizer.json`
  );
  console.log("     + Fertilizer recipe added");

  // ============================================
  // Print Summary
  // ============================================
  console.log("\n========================================");
  console.log("DEPLOYMENT COMPLETE!");
  console.log("========================================\n");

  console.log("Contract Addresses:");
  console.log("-------------------");
  console.log(`FarmToken (FGOLD):  ${farmTokenAddress}`);
  console.log(`FarmNFT (FITEM):    ${farmNFTAddress}`);
  console.log(`FarmLand (FLAND):   ${farmLandAddress}`);
  console.log(`GameManager:        ${gameManagerAddress}`);
  console.log(`Marketplace:        ${marketplaceAddress}`);

  console.log("\nConfiguration:");
  console.log("--------------");
  console.log(`Base URI:           ${BASE_URI}`);
  console.log(`Land Mint Price:    ${hre.ethers.formatEther(LAND_MINT_PRICE)} ETH`);
  console.log(`Marketplace Fee:    ${MARKETPLACE_FEE / 100}%`);
  console.log(`Seed Types Added:   4`);
  console.log(`Crafting Recipes:   4`);

  console.log("\nInitial Token Supply:");
  console.log("---------------------");
  const totalSupply = await farmToken.totalSupply();
  console.log(`FGOLD Total Supply: ${hre.ethers.formatEther(totalSupply)} FGOLD`);

  // Verification instructions
  console.log("\n========================================");
  console.log("VERIFICATION COMMANDS");
  console.log("========================================\n");
  console.log("Run these commands to verify contracts on Etherscan:\n");
  console.log(`npx hardhat verify --network sepolia ${farmTokenAddress} "${deployer.address}"`);
  console.log(`npx hardhat verify --network sepolia ${farmNFTAddress} "${deployer.address}" "${BASE_URI}"`);
  console.log(`npx hardhat verify --network sepolia ${farmLandAddress} "${deployer.address}" "${BASE_URI}" "${LAND_MINT_PRICE}"`);
  console.log(`npx hardhat verify --network sepolia ${gameManagerAddress} "${deployer.address}" "${farmTokenAddress}" "${farmNFTAddress}" "${farmLandAddress}"`);
  console.log(`npx hardhat verify --network sepolia ${marketplaceAddress} "${deployer.address}" "${farmTokenAddress}" "${MARKETPLACE_FEE}"`);

  // Return addresses for use in other scripts
  return {
    farmToken: farmTokenAddress,
    farmNFT: farmNFTAddress,
    farmLand: farmLandAddress,
    gameManager: gameManagerAddress,
    marketplace: marketplaceAddress,
  };
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
