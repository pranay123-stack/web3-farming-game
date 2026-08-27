export interface SeedTypeInfo {
  id: number
  growthTime: number
  baseYield: bigint
  seedCost: bigint
  xpReward: bigint
  requiredLevel: number
  rarity: number
  seedURI: string
  cropURI: string
  isActive: boolean
}

export interface RecipeInfo {
  id: number
  tokenCost: bigint
  resultType: number
  resultRarity: number
  resultPower: bigint
  resultDurability: bigint
  resultGrowthTime: bigint
  resultYield: bigint
  xpReward: bigint
  requiredLevel: number
  materialType: number
  materialCount: number
  resultURI: string
  isActive: boolean
}

export interface GameCatalog {
  seeds: SeedTypeInfo[]
  recipes: RecipeInfo[]
  landMintPrice: bigint
  marketplaceFeeBps: number
  maxLandLevel: number
}

export interface PlayerProfile {
  xp: bigint
  level: number
  xpForNextLevel: bigint
  xpForCurrentLevel: bigint
  totalHarvests: number
  totalPlanted: number
  totalCrafted: number
  totalUpgrades: number
  hasClaimedStarterPack: boolean
}

export interface LandPlotInfo {
  tokenId: bigint
  x: number
  y: number
  fertility: number
  level: number
  isLocked: boolean
  lockedUntil: number
  plantedSeedId: bigint
  plantedAt: number
  /** Present when a crop is growing on this plot. */
  farm: ActiveFarm | null
  /** Yield multiplier in basis points, from the chain's own formula. */
  yieldBps: number
  upgradeCost: bigint
}

export interface ActiveFarm {
  landTokenId: bigint
  seedTypeId: number
  seedTokenId: bigint
  plantedAt: number
  harvestAt: number
  expectedYield: bigint
  isActive: boolean
}

export interface InventoryItem {
  tokenId: bigint
  itemType: number
  rarity: number
  power: bigint
  durability: bigint
  growthTime: number
  yieldAmount: bigint
  seedTypeId: number
}

export interface MarketListing {
  listingId: bigint
  seller: string
  nftContract: string
  tokenId: bigint
  price: bigint
  listedAt: number
  isActive: boolean
  /** Resolved item stats when the listing is a FarmNFT item. */
  item: InventoryItem | null
  /** Resolved plot data when the listing is a FarmLand plot. */
  plot: { x: number; y: number; fertility: number; level: number } | null
  collection: 'item' | 'land' | 'unknown'
}

export interface PlayerBalances {
  fgold: bigint
  /** Allowance granted to GameManager, which spends via burnFrom. */
  gameAllowance: bigint
  /** Allowance granted to Marketplace, which settles purchases. */
  marketAllowance: bigint
  /** True when FarmNFT is setApprovalForAll'd to the marketplace. */
  nftApprovedForMarket: boolean
  landApprovedForMarket: boolean
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'
