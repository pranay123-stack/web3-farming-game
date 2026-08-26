'use client'

import { useState, useEffect, useCallback } from 'react'
import { BrowserProvider, JsonRpcSigner, formatEther } from 'ethers'
import { create } from 'zustand'
import { NETWORK_CONFIG } from '@/lib/contracts'

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, callback: (...args: unknown[]) => void) => void
      removeListener: (event: string, callback: (...args: unknown[]) => void) => void
    }
  }
}

interface WalletState {
  address: string | null
  isConnected: boolean
  isConnecting: boolean
  chainId: number | null
  balance: string
  error: string | null
  provider: BrowserProvider | null
  signer: JsonRpcSigner | null
  setAddress: (address: string | null) => void
  setIsConnected: (connected: boolean) => void
  setIsConnecting: (connecting: boolean) => void
  setChainId: (chainId: number | null) => void
  setBalance: (balance: string) => void
  setError: (error: string | null) => void
  setProvider: (provider: BrowserProvider | null) => void
  setSigner: (signer: JsonRpcSigner | null) => void
  reset: () => void
}

const useWalletStore = create<WalletState>((set) => ({
  address: null,
  isConnected: false,
  isConnecting: false,
  chainId: null,
  balance: '0',
  error: null,
  provider: null,
  signer: null,
  setAddress: (address) => set({ address }),
  setIsConnected: (isConnected) => set({ isConnected }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setChainId: (chainId) => set({ chainId }),
  setBalance: (balance) => set({ balance }),
  setError: (error) => set({ error }),
  setProvider: (provider) => set({ provider }),
  setSigner: (signer) => set({ signer }),
  reset: () => set({
    address: null,
    isConnected: false,
    isConnecting: false,
    chainId: null,
    balance: '0',
    error: null,
    provider: null,
    signer: null,
  }),
}))

export function useWallet() {
  const store = useWalletStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Check if MetaMask is installed
  const isMetaMaskInstalled = useCallback(() => {
    return typeof window !== 'undefined' && !!window.ethereum?.isMetaMask
  }, [])

  // Get balance for an address
  const fetchBalance = useCallback(async (address: string, provider: BrowserProvider) => {
    try {
      const balance = await provider.getBalance(address)
      store.setBalance(formatEther(balance))
    } catch (error) {
      console.error('Error fetching balance:', error)
    }
  }, [store])

  // Switch to the correct network
  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return false

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${NETWORK_CONFIG.chainId.toString(16)}` }],
      })
      return true
    } catch (switchError: unknown) {
      // Chain not added, try to add it
      if ((switchError as { code: number }).code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: `0x${NETWORK_CONFIG.chainId.toString(16)}`,
                chainName: NETWORK_CONFIG.chainName,
                rpcUrls: [NETWORK_CONFIG.rpcUrl],
                blockExplorerUrls: [NETWORK_CONFIG.blockExplorer],
                nativeCurrency: NETWORK_CONFIG.nativeCurrency,
              },
            ],
          })
          return true
        } catch (addError) {
          console.error('Error adding network:', addError)
          return false
        }
      }
      console.error('Error switching network:', switchError)
      return false
    }
  }, [])

  // Connect wallet
  const connect = useCallback(async () => {
    if (!isMetaMaskInstalled()) {
      store.setError('MetaMask is not installed. Please install it to continue.')
      window.open('https://metamask.io/download/', '_blank')
      return
    }

    store.setIsConnecting(true)
    store.setError(null)

    try {
      const provider = new BrowserProvider(window.ethereum!)
      const accounts = await window.ethereum!.request({
        method: 'eth_requestAccounts',
      }) as string[]

      if (accounts.length === 0) {
        throw new Error('No accounts found')
      }

      const address = accounts[0]
      const network = await provider.getNetwork()
      const chainId = Number(network.chainId)

      // Check if on correct network
      if (chainId !== NETWORK_CONFIG.chainId) {
        const switched = await switchNetwork()
        if (!switched) {
          store.setError(`Please switch to ${NETWORK_CONFIG.chainName} network`)
          store.setIsConnecting(false)
          return
        }
      }

      const signer = await provider.getSigner()

      store.setProvider(provider)
      store.setSigner(signer)
      store.setAddress(address)
      store.setChainId(chainId)
      store.setIsConnected(true)

      await fetchBalance(address, provider)
    } catch (error: unknown) {
      console.error('Error connecting wallet:', error)
      store.setError((error as Error).message || 'Failed to connect wallet')
    } finally {
      store.setIsConnecting(false)
    }
  }, [isMetaMaskInstalled, switchNetwork, fetchBalance, store])

  // Disconnect wallet
  const disconnect = useCallback(() => {
    store.reset()
  }, [store])

  // Handle account changes
  useEffect(() => {
    if (!mounted || !window.ethereum) return

    const handleAccountsChanged = (accounts: unknown) => {
      const accountList = accounts as string[]
      if (accountList.length === 0) {
        disconnect()
      } else if (accountList[0] !== store.address) {
        store.setAddress(accountList[0])
        if (store.provider) {
          fetchBalance(accountList[0], store.provider)
        }
      }
    }

    const handleChainChanged = (chainIdHex: unknown) => {
      const chainId = parseInt(chainIdHex as string, 16)
      store.setChainId(chainId)
      if (chainId !== NETWORK_CONFIG.chainId) {
        store.setError(`Please switch to ${NETWORK_CONFIG.chainName} network`)
      } else {
        store.setError(null)
      }
    }

    const handleDisconnect = () => {
      disconnect()
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    window.ethereum.on('disconnect', handleDisconnect)

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum?.removeListener('chainChanged', handleChainChanged)
      window.ethereum?.removeListener('disconnect', handleDisconnect)
    }
  }, [mounted, store, disconnect, fetchBalance])

  // Auto-connect if previously connected
  useEffect(() => {
    if (!mounted || !window.ethereum) return

    const checkConnection = async () => {
      try {
        const accounts = await window.ethereum!.request({
          method: 'eth_accounts',
        }) as string[]

        if (accounts.length > 0) {
          await connect()
        }
      } catch (error) {
        console.error('Error checking connection:', error)
      }
    }

    checkConnection()
  }, [mounted, connect])

  return {
    address: store.address,
    isConnected: store.isConnected,
    isConnecting: store.isConnecting,
    chainId: store.chainId,
    balance: store.balance,
    error: store.error,
    provider: store.provider,
    signer: store.signer,
    connect,
    disconnect,
    switchNetwork,
    isMetaMaskInstalled,
  }
}
