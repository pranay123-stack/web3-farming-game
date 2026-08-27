import { Contract, JsonRpcProvider, type ContractRunner } from 'ethers'
import {
  FARM_TOKEN_ABI,
  FARM_NFT_ABI,
  FARM_LAND_ABI,
  GAME_MANAGER_ABI,
  MARKETPLACE_ABI,
} from './generated/abis'
import { getDeployment, getReadRpcUrl, TARGET_CHAIN_ID } from './chains'

export {
  FARM_TOKEN_ABI,
  FARM_NFT_ABI,
  FARM_LAND_ABI,
  GAME_MANAGER_ABI,
  MARKETPLACE_ABI,
}

export type ContractName =
  | 'FarmToken'
  | 'FarmNFT'
  | 'FarmLand'
  | 'GameManager'
  | 'Marketplace'

const ABIS = {
  FarmToken: FARM_TOKEN_ABI,
  FarmNFT: FARM_NFT_ABI,
  FarmLand: FARM_LAND_ABI,
  GameManager: GAME_MANAGER_ABI,
  Marketplace: MARKETPLACE_ABI,
} as const

export class MissingDeploymentError extends Error {
  constructor(public readonly chainId: number) {
    super(
      `No contract deployment recorded for chain ${chainId}. ` +
        `Deploy the contracts and run "npm run export:abi".`
    )
    this.name = 'MissingDeploymentError'
  }
}

export function getContractAddress(name: ContractName, chainId: number = TARGET_CHAIN_ID): string {
  const deployment = getDeployment(chainId)
  if (!deployment) throw new MissingDeploymentError(chainId)
  return deployment.contracts[name]
}

export function getContractAddresses(chainId: number = TARGET_CHAIN_ID) {
  const deployment = getDeployment(chainId)
  if (!deployment) throw new MissingDeploymentError(chainId)
  return deployment.contracts
}

export function hasDeployment(chainId: number = TARGET_CHAIN_ID): boolean {
  return getDeployment(chainId) !== null
}

/**
 * Builds a contract bound to `runner`. Pass a signer for writes, a provider
 * for reads. ABIs come from the compiled artifacts, so a typo becomes a build
 * error rather than a runtime revert.
 */
export function getContract(
  name: ContractName,
  runner: ContractRunner,
  chainId: number = TARGET_CHAIN_ID
): Contract {
  return new Contract(getContractAddress(name, chainId), ABIS[name] as unknown as any[], runner)
}

let cachedReadProvider: JsonRpcProvider | null = null
let cachedReadChainId: number | null = null

/**
 * Provider for reads that must work before a wallet connects (the landing
 * page's live stats, the marketplace browser). `staticNetwork` avoids a
 * per-call `eth_chainId` round-trip.
 */
export function getReadProvider(chainId: number = TARGET_CHAIN_ID): JsonRpcProvider {
  if (cachedReadProvider && cachedReadChainId === chainId) return cachedReadProvider
  cachedReadProvider?.destroy()
  cachedReadProvider = new JsonRpcProvider(getReadRpcUrl(chainId), chainId, {
    staticNetwork: true,
  })
  cachedReadChainId = chainId
  return cachedReadProvider
}

export function getReadContract(name: ContractName, chainId: number = TARGET_CHAIN_ID): Contract {
  return getContract(name, getReadProvider(chainId), chainId)
}
