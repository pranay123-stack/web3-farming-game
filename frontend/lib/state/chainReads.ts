import type { Contract } from 'ethers'
import type {
  ActiveFarm, GameCatalog, InventoryItem, LandPlotInfo, MarketListing,
  PlayerBalances, PlayerProfile, RecipeInfo, SeedTypeInfo,
} from './gameTypes'

/**
 * Pure decoders that turn raw contract structs into the shapes the UI uses.
 *
 * Reads are batched with Promise.all wherever the calls are independent, which
 * keeps a full refresh to a handful of RPC round-trips instead of one per
 * field.
 */

export function decodeSeedType(raw: any, id: number): SeedTypeInfo {
  return {
    id,
    growthTime: Number(raw.growthTime),
    baseYield: raw.baseYield,
    seedCost: raw.seedCost,
    xpReward: raw.xpReward,
    requiredLevel: Number(raw.requiredLevel),
    rarity: Number(raw.rarity),
    seedURI: raw.seedURI,
    cropURI: raw.cropURI,
    isActive: raw.isActive,
  }
}

export function decodeRecipe(raw: any, id: number): RecipeInfo {
  return {
    id,
    tokenCost: raw.tokenCost,
    resultType: Number(raw.resultType),
    resultRarity: Number(raw.resultRarity),
    resultPower: raw.resultPower,
    resultDurability: raw.resultDurability,
    resultGrowthTime: raw.resultGrowthTime,
    resultYield: raw.resultYield,
    xpReward: raw.xpReward,
    requiredLevel: Number(raw.requiredLevel),
    materialType: Number(raw.materialType),
    materialCount: Number(raw.materialCount),
    resultURI: raw.resultURI,
    isActive: raw.isActive,
  }
}

export function decodeItem(tokenId: bigint, raw: any): InventoryItem {
  return {
    tokenId,
    itemType: Number(raw.itemType),
    rarity: Number(raw.rarity),
    power: raw.power,
    durability: raw.durability,
    growthTime: Number(raw.growthTime),
    yieldAmount: raw.yieldAmount,
    seedTypeId: Number(raw.seedTypeId),
  }
}

export function decodeFarm(raw: any): ActiveFarm {
  return {
    landTokenId: raw.landTokenId,
    seedTypeId: Number(raw.seedTypeId),
    seedTokenId: raw.seedTokenId,
    plantedAt: Number(raw.plantedAt),
    harvestAt: Number(raw.harvestAt),
    expectedYield: raw.expectedYield,
    isActive: raw.isActive,
  }
}

/** Loaded once per session - the catalog only changes on an admin action. */
export async function loadCatalog(
  gameManager: Contract,
  farmLand: Contract,
  marketplace: Contract
): Promise<GameCatalog> {
  const [rawSeeds, rawRecipes, landMintPrice, feeBps, maxLevel] = await Promise.all([
    gameManager.getAllSeedTypes(),
    gameManager.getAllRecipes(),
    farmLand.mintPrice(),
    marketplace.marketplaceFee(),
    farmLand.MAX_LEVEL(),
  ])

  return {
    seeds: (rawSeeds as any[]).map(decodeSeedType),
    recipes: (rawRecipes as any[]).map(decodeRecipe),
    landMintPrice,
    marketplaceFeeBps: Number(feeBps),
    maxLandLevel: Number(maxLevel),
  }
}

export async function loadProfile(
  gameManager: Contract,
  address: string
): Promise<PlayerProfile> {
  const raw = await gameManager.getPlayerProfile(address)
  const level = Number(raw.level)
  const xpForCurrentLevel = await gameManager.xpRequiredForLevel(level)
  return {
    xp: raw.xp,
    level,
    xpForNextLevel: raw.xpForNextLevel,
    xpForCurrentLevel,
    totalHarvests: Number(raw.totalHarvests),
    totalPlanted: Number(raw.totalPlanted),
    totalCrafted: Number(raw.totalCrafted),
    totalUpgrades: Number(raw.totalUpgrades),
    hasClaimedStarterPack: raw.hasClaimedStarterPack,
  }
}

export async function loadBalances(
  farmToken: Contract,
  farmNFT: Contract,
  farmLand: Contract,
  address: string,
  gameManagerAddress: string,
  marketplaceAddress: string
): Promise<PlayerBalances> {
  const [fgold, gameAllowance, marketAllowance, nftApproved, landApproved] = await Promise.all([
    farmToken.balanceOf(address),
    farmToken.allowance(address, gameManagerAddress),
    farmToken.allowance(address, marketplaceAddress),
    farmNFT.isApprovedForAll(address, marketplaceAddress),
    farmLand.isApprovedForAll(address, marketplaceAddress),
  ])
  return {
    fgold,
    gameAllowance,
    marketAllowance,
    nftApprovedForMarket: nftApproved,
    landApprovedForMarket: landApproved,
  }
}

/**
 * Land plots plus any crop growing on them.
 *
 * `getPlotsByOwner` returns ids and structs together, and active farms come
 * back in one call, so this is two RPC round-trips regardless of how many
 * plots a player owns.
 */
export async function loadLands(
  gameManager: Contract,
  farmLand: Contract,
  address: string,
  upgradeCostFor: (level: number) => Promise<bigint>
): Promise<LandPlotInfo[]> {
  const [[tokenIds, plots], rawFarms] = await Promise.all([
    farmLand.getPlotsByOwner(address, 0, 200),
    gameManager.getPlayerActiveFarms(address),
  ])

  const farms = (rawFarms as any[]).map(decodeFarm).filter((f) => f.isActive)
  const farmsByLand = new Map<string, ActiveFarm>()
  for (const farm of farms) farmsByLand.set(farm.landTokenId.toString(), farm)

  const ids = tokenIds as bigint[]
  const rawPlots = plots as any[]

  const results = await Promise.all(
    ids.map(async (tokenId, index) => {
      const plot = rawPlots[index]
      const level = Number(plot.level)
      const fertility = Number(plot.fertility)
      const [yieldBps, upgradeCost] = await Promise.all([
        gameManager.yieldMultiplierBps(fertility, level),
        upgradeCostFor(level),
      ])
      return {
        tokenId,
        x: Number(plot.x),
        y: Number(plot.y),
        fertility,
        level,
        isLocked: plot.isLocked,
        lockedUntil: Number(plot.lockedUntil),
        plantedSeedId: plot.plantedSeedId,
        plantedAt: Number(plot.plantedAt),
        farm: farmsByLand.get(tokenId.toString()) ?? null,
        yieldBps: Number(yieldBps),
        upgradeCost,
      } satisfies LandPlotInfo
    })
  )

  return results.sort((a, b) => (a.tokenId < b.tokenId ? -1 : 1))
}

export async function loadInventory(
  farmNFT: Contract,
  address: string
): Promise<InventoryItem[]> {
  const [tokenIds, items] = await farmNFT.getInventory(address, 0, 300)
  return (tokenIds as bigint[]).map((tokenId, index) => decodeItem(tokenId, (items as any[])[index]))
}

/**
 * Active marketplace listings, enriched with the underlying asset's stats so
 * the browser can render a real card rather than a bare token id.
 */
export async function loadListings(
  marketplace: Contract,
  farmNFT: Contract,
  farmLand: Contract,
  farmNFTAddress: string,
  farmLandAddress: string,
  offset = 0,
  limit = 60
): Promise<MarketListing[]> {
  const [rawListings, ids] = await marketplace.getActiveListings(offset, limit)
  const listings = rawListings as any[]

  return Promise.all(
    listings.map(async (raw, index) => {
      const nftContract: string = raw.nftContract
      const isItem = nftContract.toLowerCase() === farmNFTAddress.toLowerCase()
      const isLand = nftContract.toLowerCase() === farmLandAddress.toLowerCase()

      let item: InventoryItem | null = null
      let plot: MarketListing['plot'] = null

      try {
        if (isItem) {
          const [found, data] = await farmNFT.tryGetItem(raw.tokenId)
          if (found) item = decodeItem(raw.tokenId, data)
        } else if (isLand) {
          const data = await farmLand.getLandPlot(raw.tokenId)
          plot = {
            x: Number(data.x),
            y: Number(data.y),
            fertility: Number(data.fertility),
            level: Number(data.level),
          }
        }
      } catch {
        // A listing whose asset cannot be read still renders, just plainly.
      }

      return {
        listingId: (ids as bigint[])[index],
        seller: raw.seller,
        nftContract,
        tokenId: raw.tokenId,
        price: raw.price,
        listedAt: Number(raw.listedAt),
        isActive: raw.isActive,
        item,
        plot,
        collection: isItem ? 'item' : isLand ? 'land' : 'unknown',
      } satisfies MarketListing
    })
  )
}
