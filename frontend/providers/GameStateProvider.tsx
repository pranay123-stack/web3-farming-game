'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { Contract } from 'ethers'
import { useWallet } from '@/hooks/useWallet'
import { getContract, getReadContract, getContractAddresses, hasDeployment } from '@/lib/contracts'
import { TARGET_CHAIN_ID } from '@/lib/chains'
import {
  loadBalances, loadCatalog, loadInventory, loadLands, loadListings, loadProfile,
} from '@/lib/state/chainReads'
import type {
  GameCatalog, InventoryItem, LandPlotInfo, LoadState, MarketListing, PlayerBalances, PlayerProfile,
} from '@/lib/state/gameTypes'

/**
 * Owns every piece of chain-derived state the game needs.
 *
 * There is exactly one of these, so there is exactly one copy of each value -
 * no component holds its own balance or inventory. Synchronisation is:
 *
 *   1. On connect / account change (keyed on the wallet's `epoch`).
 *   2. Immediately after any transaction confirms (`refreshAfterTx`).
 *   3. From contract events, for state other players can change.
 *   4. A slow visibility-gated poll as a backstop.
 *
 * There are no optimistic economic updates anywhere: a balance shown is a
 * balance the chain returned.
 */

interface GameStateValue {
  catalog: GameCatalog | null
  catalogState: LoadState
  profile: PlayerProfile | null
  balances: PlayerBalances | null
  lands: LandPlotInfo[]
  inventory: InventoryItem[]
  listings: MarketListing[]
  playerState: LoadState
  marketState: LoadState
  error: string | null
  /** Server-derived clock, in seconds. Drives every growth countdown. */
  chainNow: number

  contracts: {
    gameManager: Contract | null
    farmToken: Contract | null
    farmNFT: Contract | null
    farmLand: Contract | null
    marketplace: Contract | null
  }
  addresses: ReturnType<typeof getContractAddresses> | null

  refreshPlayer: () => Promise<void>
  refreshMarket: () => Promise<void>
  refreshAll: () => Promise<void>
  hasDeployment: boolean
}

const GameStateContext = createContext<GameStateValue | null>(null)

const POLL_INTERVAL_MS = 60_000

export function GameStateProvider({ children }: { children: React.ReactNode }) {
  const { address, signer, provider, chainId, canTransact, epoch } = useWallet()

  const [catalog, setCatalog] = useState<GameCatalog | null>(null)
  const [catalogState, setCatalogState] = useState<LoadState>('idle')
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [balances, setBalances] = useState<PlayerBalances | null>(null)
  const [lands, setLands] = useState<LandPlotInfo[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [listings, setListings] = useState<MarketListing[]>([])
  const [playerState, setPlayerState] = useState<LoadState>('idle')
  const [marketState, setMarketState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [chainNow, setChainNow] = useState(() => Math.floor(Date.now() / 1000))

  const deploymentAvailable = hasDeployment(TARGET_CHAIN_ID)
  const addresses = useMemo(
    () => (deploymentAvailable ? getContractAddresses(TARGET_CHAIN_ID) : null),
    [deploymentAvailable]
  )

  /**
   * Read contracts use the wallet's provider when it is on the right chain,
   * and the public RPC otherwise - so the marketplace and catalog still render
   * for a visitor with no wallet at all.
   */
  const readRunner = useMemo(() => {
    if (provider && chainId === TARGET_CHAIN_ID) return provider
    return null
  }, [provider, chainId])

  const contracts = useMemo(() => {
    if (!deploymentAvailable) {
      return { gameManager: null, farmToken: null, farmNFT: null, farmLand: null, marketplace: null }
    }
    const make = (name: Parameters<typeof getContract>[0]) => {
      // Writes need the signer; everything else can read from any runner.
      if (canTransact && signer) return getContract(name, signer, TARGET_CHAIN_ID)
      if (readRunner) return getContract(name, readRunner, TARGET_CHAIN_ID)
      return getReadContract(name, TARGET_CHAIN_ID)
    }
    return {
      gameManager: make('GameManager'),
      farmToken: make('FarmToken'),
      farmNFT: make('FarmNFT'),
      farmLand: make('FarmLand'),
      marketplace: make('Marketplace'),
    }
  }, [deploymentAvailable, canTransact, signer, readRunner])

  // --- catalog (once per session) ----------------------------------------
  useEffect(() => {
    if (!deploymentAvailable) {
      setCatalogState('error')
      return
    }
    let cancelled = false
    setCatalogState('loading')
    ;(async () => {
      try {
        const gm = getReadContract('GameManager', TARGET_CHAIN_ID)
        const land = getReadContract('FarmLand', TARGET_CHAIN_ID)
        const market = getReadContract('Marketplace', TARGET_CHAIN_ID)
        const loaded = await loadCatalog(gm, land, market)
        if (cancelled) return
        setCatalog(loaded)
        setCatalogState('ready')
      } catch (err) {
        if (cancelled) return
        console.error('[game] catalog load failed', err)
        setCatalogState('error')
        setError('Could not load game content from the chain.')
      }
    })()
    return () => { cancelled = true }
  }, [deploymentAvailable])

  // --- player state -------------------------------------------------------
  const refreshingPlayer = useRef(false)

  const refreshPlayer = useCallback(async () => {
    if (!address || !deploymentAvailable || !addresses) {
      setProfile(null); setBalances(null); setLands([]); setInventory([])
      setPlayerState('idle')
      return
    }
    if (refreshingPlayer.current) return
    refreshingPlayer.current = true
    setPlayerState((prev) => (prev === 'ready' ? 'ready' : 'loading'))

    try {
      const gm = getReadContract('GameManager', TARGET_CHAIN_ID)
      const token = getReadContract('FarmToken', TARGET_CHAIN_ID)
      const nft = getReadContract('FarmNFT', TARGET_CHAIN_ID)
      const land = getReadContract('FarmLand', TARGET_CHAIN_ID)

      const upgradeCostCache = new Map<number, bigint>()
      const upgradeCostFor = async (level: number) => {
        const cached = upgradeCostCache.get(level)
        if (cached !== undefined) return cached
        const cost: bigint = await gm.getUpgradeCost(level)
        upgradeCostCache.set(level, cost)
        return cost
      }

      const [nextProfile, nextBalances, nextLands, nextInventory, block] = await Promise.all([
        loadProfile(gm, address),
        loadBalances(token, nft, land, address, addresses.GameManager, addresses.Marketplace),
        loadLands(gm, land, address, upgradeCostFor),
        loadInventory(nft, address),
        gm.runner?.provider?.getBlock('latest'),
      ])

      setProfile(nextProfile)
      setBalances(nextBalances)
      setLands(nextLands)
      setInventory(nextInventory)
      if (block?.timestamp) setChainNow(Number(block.timestamp))
      setPlayerState('ready')
      setError(null)
    } catch (err) {
      console.error('[game] player refresh failed', err)
      setPlayerState('error')
      setError('Could not read your farm from the chain. Retrying shortly.')
    } finally {
      refreshingPlayer.current = false
    }
  }, [address, deploymentAvailable, addresses])

  // --- marketplace --------------------------------------------------------
  const refreshingMarket = useRef(false)

  const refreshMarket = useCallback(async () => {
    if (!deploymentAvailable || !addresses) return
    if (refreshingMarket.current) return
    refreshingMarket.current = true
    setMarketState((prev) => (prev === 'ready' ? 'ready' : 'loading'))
    try {
      const market = getReadContract('Marketplace', TARGET_CHAIN_ID)
      const nft = getReadContract('FarmNFT', TARGET_CHAIN_ID)
      const land = getReadContract('FarmLand', TARGET_CHAIN_ID)
      const next = await loadListings(market, nft, land, addresses.FarmNFT, addresses.FarmLand)
      setListings(next)
      setMarketState('ready')
    } catch (err) {
      console.error('[game] market refresh failed', err)
      setMarketState('error')
    } finally {
      refreshingMarket.current = false
    }
  }, [deploymentAvailable, addresses])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshPlayer(), refreshMarket()])
  }, [refreshPlayer, refreshMarket])

  // Refetch whenever the account or chain changes.
  useEffect(() => { void refreshPlayer() }, [refreshPlayer, epoch])
  useEffect(() => { void refreshMarket() }, [refreshMarket])

  // --- local clock --------------------------------------------------------
  // Ticks between chain reads so countdowns move smoothly; every refresh
  // re-anchors it to a real block timestamp, so drift cannot accumulate.
  useEffect(() => {
    const id = setInterval(() => setChainNow((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // --- event-driven sync --------------------------------------------------
  // Marketplace state changes because of other players, so it is worth
  // subscribing to. Personal state is refreshed after our own transactions.
  useEffect(() => {
    if (!deploymentAvailable) return
    const market = getReadContract('Marketplace', TARGET_CHAIN_ID)
    let timer: ReturnType<typeof setTimeout> | null = null

    const debouncedRefresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void refreshMarket() }, 1500)
    }

    const events = ['ItemListed', 'ItemSold', 'ListingCanceled', 'ListingPriceUpdated']
    for (const event of events) market.on(event, debouncedRefresh)

    return () => {
      if (timer) clearTimeout(timer)
      for (const event of events) market.off(event, debouncedRefresh)
    }
  }, [deploymentAvailable, refreshMarket])

  // --- backstop poll ------------------------------------------------------
  // Only while the tab is visible, so a backgrounded game stops costing RPC.
  useEffect(() => {
    if (!address) return
    let id: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (id) return
      id = setInterval(() => { void refreshPlayer() }, POLL_INTERVAL_MS)
    }
    const stop = () => {
      if (id) { clearInterval(id); id = null }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { void refreshPlayer(); start() } else { stop() }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [address, refreshPlayer])

  const value = useMemo<GameStateValue>(() => ({
    catalog, catalogState, profile, balances, lands, inventory, listings,
    playerState, marketState, error, chainNow,
    contracts, addresses,
    refreshPlayer, refreshMarket, refreshAll,
    hasDeployment: deploymentAvailable,
  }), [
    catalog, catalogState, profile, balances, lands, inventory, listings,
    playerState, marketState, error, chainNow,
    contracts, addresses, refreshPlayer, refreshMarket, refreshAll, deploymentAvailable,
  ])

  return <GameStateContext.Provider value={value}>{children}</GameStateContext.Provider>
}

export function useGameState(): GameStateValue {
  const context = useContext(GameStateContext)
  if (!context) {
    throw new Error('useGameState must be used inside a <GameStateProvider>')
  }
  return context
}
