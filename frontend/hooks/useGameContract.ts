'use client'

import { useState, useCallback, useEffect } from 'react'
import { Contract, formatUnits, parseUnits } from 'ethers'
import { useWallet } from './useWallet'
import {
  CONTRACT_ADDRESSES,
  GAME_CONTRACT_ABI,
  FARM_TOKEN_ABI,
  CROP_NFT_ABI,
  ITEM_NFT_ABI,
  SEED_INFO,
} from '@/lib/contracts'

interface PlotData {
  owner: string
  seedType: number
  plantedAt: number
  waterLevel: number
  isReady: boolean
}

interface PlayerStats {
  level: number
  experience: number
  totalHarvests: number
}

interface OwnedNFT {
  tokenId: number
  type: 'crop' | 'item'
  name: string
  emoji: string
  amount?: number
}

export function useGameContract() {
  const { signer, provider, address, isConnected } = useWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [tokenBalance, setTokenBalance] = useState('0')
  const [ownedNFTs, setOwnedNFTs] = useState<OwnedNFT[]>([])
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create contract instances
  const getGameContract = useCallback(() => {
    if (!signer) return null
    return new Contract(CONTRACT_ADDRESSES.GAME_CONTRACT, GAME_CONTRACT_ABI, signer)
  }, [signer])

  const getTokenContract = useCallback(() => {
    if (!provider) return null
    return new Contract(CONTRACT_ADDRESSES.FARM_TOKEN, FARM_TOKEN_ABI, signer || provider)
  }, [provider, signer])

  const getCropNFTContract = useCallback(() => {
    if (!provider) return null
    return new Contract(CONTRACT_ADDRESSES.CROP_NFT, CROP_NFT_ABI, signer || provider)
  }, [provider, signer])

  const getItemNFTContract = useCallback(() => {
    if (!provider) return null
    return new Contract(CONTRACT_ADDRESSES.ITEM_NFT, ITEM_NFT_ABI, signer || provider)
  }, [provider, signer])

  // Fetch token balance
  const fetchTokenBalance = useCallback(async () => {
    if (!address || !provider) return

    try {
      const tokenContract = getTokenContract()
      if (!tokenContract) return

      const balance = await tokenContract.balanceOf(address)
      setTokenBalance(formatUnits(balance, 18))
    } catch (err) {
      console.error('Error fetching token balance:', err)
      // Set mock balance for demo
      setTokenBalance('1000')
    }
  }, [address, provider, getTokenContract])

  // Fetch owned NFTs
  const fetchOwnedNFTs = useCallback(async () => {
    if (!address || !provider) return

    try {
      // In a real implementation, you would query events or use a subgraph
      // For demo, we'll set some mock data
      setOwnedNFTs([
        { tokenId: 1, type: 'crop', name: 'Wheat', emoji: '🌾', amount: 5 },
        { tokenId: 2, type: 'crop', name: 'Corn', emoji: '🌽', amount: 3 },
        { tokenId: 3, type: 'item', name: 'Fertilizer', emoji: '🧪', amount: 10 },
        { tokenId: 4, type: 'item', name: 'Seeds', emoji: '🌱', amount: 20 },
      ])
    } catch (err) {
      console.error('Error fetching NFTs:', err)
    }
  }, [address, provider])

  // Fetch player stats
  const fetchPlayerStats = useCallback(async () => {
    if (!address || !provider) return

    try {
      const gameContract = getGameContract()
      if (!gameContract) return

      const stats = await gameContract.getPlayerStats(address)
      setPlayerStats({
        level: Number(stats.level),
        experience: Number(stats.experience),
        totalHarvests: Number(stats.totalHarvests),
      })
    } catch (err) {
      console.error('Error fetching player stats:', err)
      // Set mock stats for demo
      setPlayerStats({
        level: 5,
        experience: 2500,
        totalHarvests: 42,
      })
    }
  }, [address, provider, getGameContract])

  // Plant a crop
  const plantCrop = useCallback(async (plotId: number, seedType: number) => {
    if (!signer || !address) {
      setError('Wallet not connected')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const gameContract = getGameContract()
      if (!gameContract) throw new Error('Contract not available')

      const tx = await gameContract.plantCrop(plotId, seedType)
      await tx.wait()

      // Refresh balances
      await fetchTokenBalance()
      await fetchOwnedNFTs()

      return true
    } catch (err: unknown) {
      console.error('Error planting crop:', err)
      setError((err as Error).message || 'Failed to plant crop')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [signer, address, getGameContract, fetchTokenBalance, fetchOwnedNFTs])

  // Harvest a crop
  const harvestCrop = useCallback(async (plotId: number) => {
    if (!signer || !address) {
      setError('Wallet not connected')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const gameContract = getGameContract()
      if (!gameContract) throw new Error('Contract not available')

      const tx = await gameContract.harvestCrop(plotId)
      await tx.wait()

      // Refresh balances
      await fetchTokenBalance()
      await fetchOwnedNFTs()
      await fetchPlayerStats()

      return true
    } catch (err: unknown) {
      console.error('Error harvesting crop:', err)
      setError((err as Error).message || 'Failed to harvest crop')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [signer, address, getGameContract, fetchTokenBalance, fetchOwnedNFTs, fetchPlayerStats])

  // Water a crop
  const waterCrop = useCallback(async (plotId: number) => {
    if (!signer || !address) {
      setError('Wallet not connected')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const gameContract = getGameContract()
      if (!gameContract) throw new Error('Contract not available')

      const tx = await gameContract.waterCrop(plotId)
      await tx.wait()

      return true
    } catch (err: unknown) {
      console.error('Error watering crop:', err)
      setError((err as Error).message || 'Failed to water crop')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [signer, address, getGameContract])

  // Craft an item
  const craftItem = useCallback(async (recipeId: number) => {
    if (!signer || !address) {
      setError('Wallet not connected')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const gameContract = getGameContract()
      if (!gameContract) throw new Error('Contract not available')

      const tx = await gameContract.craftItem(recipeId)
      await tx.wait()

      // Refresh inventory
      await fetchOwnedNFTs()

      return true
    } catch (err: unknown) {
      console.error('Error crafting item:', err)
      setError((err as Error).message || 'Failed to craft item')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [signer, address, getGameContract, fetchOwnedNFTs])

  // Get plot data
  const getPlotData = useCallback(async (plotId: number): Promise<PlotData | null> => {
    if (!provider) return null

    try {
      const gameContract = getGameContract()
      if (!gameContract) return null

      const plot = await gameContract.getPlot(plotId)
      return {
        owner: plot.owner,
        seedType: Number(plot.seedType),
        plantedAt: Number(plot.plantedAt),
        waterLevel: Number(plot.waterLevel),
        isReady: plot.isReady,
      }
    } catch (err) {
      console.error('Error getting plot data:', err)
      return null
    }
  }, [provider, getGameContract])

  // Join game (initial setup)
  const joinGame = useCallback(async () => {
    if (!signer || !address) {
      setError('Wallet not connected')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const gameContract = getGameContract()
      if (!gameContract) throw new Error('Contract not available')

      const tx = await gameContract.joinGame()
      await tx.wait()

      await fetchPlayerStats()

      return true
    } catch (err: unknown) {
      console.error('Error joining game:', err)
      setError((err as Error).message || 'Failed to join game')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [signer, address, getGameContract, fetchPlayerStats])

  // Move player on map
  const movePlayer = useCallback(async (newX: number, newY: number) => {
    if (!signer || !address) return false

    try {
      const gameContract = getGameContract()
      if (!gameContract) return false

      const tx = await gameContract.movePlayer(newX, newY)
      await tx.wait()

      return true
    } catch (err) {
      console.error('Error moving player:', err)
      return false
    }
  }, [signer, address, getGameContract])

  // Refresh all data when connected
  useEffect(() => {
    if (isConnected && address) {
      fetchTokenBalance()
      fetchOwnedNFTs()
      fetchPlayerStats()
    }
  }, [isConnected, address, fetchTokenBalance, fetchOwnedNFTs, fetchPlayerStats])

  return {
    isLoading,
    error,
    tokenBalance,
    ownedNFTs,
    playerStats,
    plantCrop,
    harvestCrop,
    waterCrop,
    craftItem,
    getPlotData,
    joinGame,
    movePlayer,
    refreshBalance: fetchTokenBalance,
    refreshNFTs: fetchOwnedNFTs,
    refreshStats: fetchPlayerStats,
  }
}
