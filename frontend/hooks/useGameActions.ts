'use client'

import { useCallback } from 'react'
import { MaxUint256 } from 'ethers'
import { useWallet } from './useWallet'
import { useGameState } from '@/providers/GameStateProvider'
import { runTransaction, type RunTransactionResult } from '@/lib/state/txStore'
import { TARGET_CHAIN_ID } from '@/lib/chains'
import { seedMeta, recipeMeta } from '@/lib/gameMeta'
import { formatToken } from '@/lib/format'

/**
 * Every write the game can perform.
 *
 * Each action follows the same shape: validate what we already know from
 * chain state (preflight), submit, wait for a receipt, then refetch. The
 * preflight step exists so the common failures - no allowance, not enough
 * FGOLD, level too low - are caught before the player is asked to sign
 * something that would revert and cost them gas.
 */

class PreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreflightError'
    // Surfaces through decodeTxError's `reason` branch as a clean message.
    ;(this as any).reason = message
  }
}

export function useGameActions() {
  const { canTransact, address } = useWallet()
  const { contracts, balances, catalog, profile, lands, addresses, refreshPlayer, refreshMarket } =
    useGameState()

  const requireReady = useCallback(() => {
    if (!canTransact) throw new PreflightError('Connect your wallet on the right network first.')
    if (!contracts.gameManager || !addresses) throw new PreflightError('Game contracts unavailable.')
  }, [canTransact, contracts.gameManager, addresses])

  const afterPlayerTx = useCallback(async () => { await refreshPlayer() }, [refreshPlayer])
  const afterMarketTx = useCallback(async () => {
    await Promise.all([refreshPlayer(), refreshMarket()])
  }, [refreshPlayer, refreshMarket])

  // ------------------------------------------------------------------ setup

  const claimStarterPack = useCallback((): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Claim starter pack',
      chainId: TARGET_CHAIN_ID,
      preflight: () => {
        requireReady()
        if (profile?.hasClaimedStarterPack) {
          throw new PreflightError('You have already claimed your starter pack.')
        }
      },
      send: () => contracts.gameManager!.claimStarterPack(),
      onConfirmed: afterPlayerTx,
    }), [contracts.gameManager, profile, requireReady, afterPlayerTx])

  /**
   * Grants GameManager an FGOLD spending allowance.
   *
   * The contracts spend via `burnFrom`, which is allowance-based on purpose:
   * it keeps the player in control rather than letting a game contract burn
   * balances at will. That costs one approval, done once.
   */
  const approveGameSpend = useCallback((amount: bigint = MaxUint256): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Approve FGOLD spending',
      chainId: TARGET_CHAIN_ID,
      preflight: requireReady,
      send: () => contracts.farmToken!.approve(addresses!.GameManager, amount),
      onConfirmed: afterPlayerTx,
    }), [contracts.farmToken, addresses, requireReady, afterPlayerTx])

  const approveMarketSpend = useCallback((amount: bigint = MaxUint256): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Approve marketplace spending',
      chainId: TARGET_CHAIN_ID,
      preflight: requireReady,
      send: () => contracts.farmToken!.approve(addresses!.Marketplace, amount),
      onConfirmed: afterMarketTx,
    }), [contracts.farmToken, addresses, requireReady, afterMarketTx])

  const approveNFTForMarket = useCallback((collection: 'item' | 'land'): Promise<RunTransactionResult> =>
    runTransaction({
      label: `Approve ${collection === 'land' ? 'land' : 'items'} for trading`,
      chainId: TARGET_CHAIN_ID,
      preflight: requireReady,
      send: () => {
        const contract = collection === 'land' ? contracts.farmLand! : contracts.farmNFT!
        return contract.setApprovalForAll(addresses!.Marketplace, true)
      },
      onConfirmed: afterMarketTx,
    }), [contracts.farmLand, contracts.farmNFT, addresses, requireReady, afterMarketTx])

  // ------------------------------------------------------------- core loop

  const purchaseSeed = useCallback((seedTypeId: number): Promise<RunTransactionResult> => {
    const meta = seedMeta(seedTypeId)
    return runTransaction({
      label: `Buy ${meta.name} seed`,
      chainId: TARGET_CHAIN_ID,
      preflight: () => {
        requireReady()
        const seed = catalog?.seeds[seedTypeId]
        if (!seed) throw new PreflightError('That seed is not available.')
        if (!seed.isActive) throw new PreflightError(`${meta.name} is no longer sold.`)
        if (profile && profile.level < seed.requiredLevel) {
          throw new PreflightError(
            `${meta.name} unlocks at level ${seed.requiredLevel}. You are level ${profile.level}.`
          )
        }
        if (balances && balances.fgold < seed.seedCost) {
          throw new PreflightError(
            `You need ${formatToken(seed.seedCost)} FGOLD but have ${formatToken(balances.fgold)}.`
          )
        }
        if (balances && balances.gameAllowance < seed.seedCost) {
          throw new PreflightError('Approve FGOLD spending before buying seeds.')
        }
      },
      send: () => contracts.gameManager!.purchaseSeed(seedTypeId),
      onConfirmed: afterPlayerTx,
    })
  }, [contracts.gameManager, catalog, profile, balances, requireReady, afterPlayerTx])

  const plantCrop = useCallback((landTokenId: bigint, seedTokenId: bigint): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Plant seed',
      chainId: TARGET_CHAIN_ID,
      preflight: () => {
        requireReady()
        const plot = lands.find((l) => l.tokenId === landTokenId)
        if (!plot) throw new PreflightError('You do not own that plot.')
        if (plot.isLocked) throw new PreflightError('That plot already has a crop growing.')
      },
      send: () => contracts.gameManager!.plantCrop(landTokenId, seedTokenId),
      onConfirmed: afterPlayerTx,
    }), [contracts.gameManager, lands, requireReady, afterPlayerTx])

  const harvestCrop = useCallback((landTokenId: bigint): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Harvest crop',
      chainId: TARGET_CHAIN_ID,
      preflight: () => {
        requireReady()
        const plot = lands.find((l) => l.tokenId === landTokenId)
        if (!plot) throw new PreflightError('You do not own that plot.')
        if (!plot.farm) throw new PreflightError('Nothing is planted on that plot.')
        // The chain re-checks this; the client check just avoids a wasted fee.
        if (Math.floor(Date.now() / 1000) < plot.farm.harvestAt) {
          throw new PreflightError('That crop is still growing.')
        }
      },
      send: () => contracts.gameManager!.harvestCrop(landTokenId),
      onConfirmed: afterPlayerTx,
    }), [contracts.gameManager, lands, requireReady, afterPlayerTx])

  const craftItem = useCallback(
    (recipeId: number, materialTokenIds: bigint[] = []): Promise<RunTransactionResult> => {
      const meta = recipeMeta(recipeId)
      return runTransaction({
        label: `Craft ${meta.name}`,
        chainId: TARGET_CHAIN_ID,
        preflight: () => {
          requireReady()
          const recipe = catalog?.recipes[recipeId]
          if (!recipe) throw new PreflightError('That recipe is not available.')
          if (!recipe.isActive) throw new PreflightError(`${meta.name} has been retired.`)
          if (profile && profile.level < recipe.requiredLevel) {
            throw new PreflightError(
              `${meta.name} unlocks at level ${recipe.requiredLevel}. You are level ${profile.level}.`
            )
          }
          if (materialTokenIds.length !== recipe.materialCount) {
            throw new PreflightError(
              `Select exactly ${recipe.materialCount} material${recipe.materialCount === 1 ? '' : 's'}.`
            )
          }
          if (balances && balances.fgold < recipe.tokenCost) {
            throw new PreflightError(
              `You need ${formatToken(recipe.tokenCost)} FGOLD but have ${formatToken(balances.fgold)}.`
            )
          }
          if (balances && recipe.tokenCost > 0n && balances.gameAllowance < recipe.tokenCost) {
            throw new PreflightError('Approve FGOLD spending before crafting.')
          }
        },
        send: () => contracts.gameManager!.craftItem(recipeId, materialTokenIds),
        onConfirmed: afterPlayerTx,
      })
    },
    [contracts.gameManager, catalog, profile, balances, requireReady, afterPlayerTx]
  )

  const upgradeLand = useCallback((landTokenId: bigint): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Upgrade plot',
      chainId: TARGET_CHAIN_ID,
      preflight: () => {
        requireReady()
        const plot = lands.find((l) => l.tokenId === landTokenId)
        if (!plot) throw new PreflightError('You do not own that plot.')
        if (plot.isLocked) throw new PreflightError('Harvest the crop before upgrading this plot.')
        if (catalog && plot.level >= catalog.maxLandLevel) {
          throw new PreflightError('This plot is already fully upgraded.')
        }
        if (balances && balances.fgold < plot.upgradeCost) {
          throw new PreflightError(
            `This upgrade costs ${formatToken(plot.upgradeCost)} FGOLD; you have ${formatToken(balances.fgold)}.`
          )
        }
        if (balances && balances.gameAllowance < plot.upgradeCost) {
          throw new PreflightError('Approve FGOLD spending before upgrading.')
        }
      },
      send: () => contracts.gameManager!.upgradeLand(landTokenId),
      onConfirmed: afterPlayerTx,
    }), [contracts.gameManager, lands, catalog, balances, requireReady, afterPlayerTx])

  const mintLand = useCallback((): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Buy a new plot',
      chainId: TARGET_CHAIN_ID,
      preflight: () => {
        requireReady()
        if (!catalog) throw new PreflightError('Game content is still loading.')
      },
      send: () => contracts.farmLand!.mintLandAuto(address!, { value: catalog!.landMintPrice }),
      onConfirmed: afterPlayerTx,
    }), [contracts.farmLand, catalog, address, requireReady, afterPlayerTx])

  // ----------------------------------------------------------- marketplace

  const listItem = useCallback(
    (collection: 'item' | 'land', tokenId: bigint, price: bigint): Promise<RunTransactionResult> =>
      runTransaction({
        label: 'List for sale',
        chainId: TARGET_CHAIN_ID,
        preflight: () => {
          requireReady()
          if (price <= 0n) throw new PreflightError('Set a price above zero.')
          const approved = collection === 'land'
            ? balances?.landApprovedForMarket
            : balances?.nftApprovedForMarket
          if (!approved) {
            throw new PreflightError('Approve the marketplace for this collection first.')
          }
        },
        send: () => contracts.marketplace!.listItem(
          collection === 'land' ? addresses!.FarmLand : addresses!.FarmNFT,
          tokenId,
          price
        ),
        onConfirmed: afterMarketTx,
      }),
    [contracts.marketplace, addresses, balances, requireReady, afterMarketTx]
  )

  /**
   * Buys a listing.
   *
   * `maxPrice` is passed through to the contract so a seller cannot raise the
   * price out from under a pending purchase. Defaults to the price the player
   * actually saw.
   */
  const buyItem = useCallback(
    (listingId: bigint, price: bigint, maxPrice?: bigint): Promise<RunTransactionResult> =>
      runTransaction({
        label: 'Buy item',
        chainId: TARGET_CHAIN_ID,
        preflight: () => {
          requireReady()
          if (balances && balances.fgold < price) {
            throw new PreflightError(
              `This costs ${formatToken(price)} FGOLD; you have ${formatToken(balances.fgold)}.`
            )
          }
          if (balances && balances.marketAllowance < price) {
            throw new PreflightError('Approve the marketplace to spend FGOLD first.')
          }
        },
        send: () => contracts.marketplace!.buyItem(listingId, maxPrice ?? price),
        onConfirmed: afterMarketTx,
      }),
    [contracts.marketplace, balances, requireReady, afterMarketTx]
  )

  const cancelListing = useCallback((listingId: bigint): Promise<RunTransactionResult> =>
    runTransaction({
      label: 'Cancel listing',
      chainId: TARGET_CHAIN_ID,
      preflight: requireReady,
      send: () => contracts.marketplace!.cancelListing(listingId),
      onConfirmed: afterMarketTx,
    }), [contracts.marketplace, requireReady, afterMarketTx])

  const updateListingPrice = useCallback(
    (listingId: bigint, newPrice: bigint): Promise<RunTransactionResult> =>
      runTransaction({
        label: 'Update price',
        chainId: TARGET_CHAIN_ID,
        preflight: () => {
          requireReady()
          if (newPrice <= 0n) throw new PreflightError('Set a price above zero.')
        },
        send: () => contracts.marketplace!.updateListingPrice(listingId, newPrice),
        onConfirmed: afterMarketTx,
      }),
    [contracts.marketplace, requireReady, afterMarketTx]
  )

  return {
    claimStarterPack,
    approveGameSpend,
    approveMarketSpend,
    approveNFTForMarket,
    purchaseSeed,
    plantCrop,
    harvestCrop,
    craftItem,
    upgradeLand,
    mintLand,
    listItem,
    buyItem,
    cancelListing,
    updateListingPrice,
  }
}
