require('@nomicfoundation/hardhat-toolbox')
require('dotenv').config()

/**
 * Hardhat configuration.
 *
 * Network accounts are only wired up when a private key is actually present.
 * The previous config fell back to a hardcoded key literal
 * (`0x000…001`, a well-known address), so a deploy with no `.env` would
 * silently sign with an account anyone controls instead of failing.
 */

const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'

// Configurable so this project can share a machine with another local chain.
// Anvil and Hardhat both default to 8545 and both report chain id 31337, so a
// hardcoded port silently points deploys at whichever one happens to be up.
const LOCALHOST_RPC_URL = process.env.LOCALHOST_RPC_URL || 'http://127.0.0.1:8545'
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || ''

/** Returns the configured deployer key, or [] so Hardhat reports it plainly. */
function deployerAccounts() {
  const key = process.env.PRIVATE_KEY
  if (!key) return []

  const normalised = key.startsWith('0x') ? key : `0x${key}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalised)) {
    throw new Error(
      'PRIVATE_KEY is set but is not a 32-byte hex string. ' +
        'Expected 64 hex characters, optionally 0x-prefixed.'
    )
  }
  return [normalised]
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // Normal builds do not need the IR pipeline - every contract fits well
      // inside the 24KB limit without it, and compiles are much faster.
      // Coverage instrumentation adds locals that push GameManager past the
      // stack limit, so `npm run coverage` turns it on via VIA_IR=true.
      viaIR: process.env.VIA_IR === 'true',
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
      // Deterministic block times keep growth-window tests reproducible.
      allowUnlimitedContractSize: false,
    },
    localhost: {
      url: LOCALHOST_RPC_URL,
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: deployerAccounts(),
      chainId: 11155111,
    },
  },

  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
    excludeContracts: ['contracts/test/'],
  },

  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },

  mocha: {
    timeout: 120000,
  },
}
