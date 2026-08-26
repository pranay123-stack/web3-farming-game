require("@nomicfoundation/hardhat-toolbox");

// Load environment variables if .env file exists
const dotenv = require("dotenv");
dotenv.config();

// Default values for deployment (will be overwritten by environment variables)
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true, // Enable IR-based code generation for better optimization
    },
  },
  networks: {
    // Local development network
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // Sepolia testnet
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
      gasPrice: "auto",
      // Free RPC endpoints for Sepolia:
      // - https://rpc.sepolia.org
      // - https://sepolia.drpc.org
      // - https://ethereum-sepolia.publicnode.com
      // - https://1rpc.io/sepolia
    },
  },
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000,
  },
};
