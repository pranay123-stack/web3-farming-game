'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@/hooks/useWallet'

interface WalletConnectProps {
  compact?: boolean
}

export default function WalletConnect({ compact = false }: WalletConnectProps) {
  const {
    address,
    isConnected,
    isConnecting,
    balance,
    error,
    connect,
    disconnect,
    isMetaMaskInstalled,
  } = useWallet()
  const [showDropdown, setShowDropdown] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const formatBalance = (bal: string) => {
    const num = parseFloat(bal)
    if (num === 0) return '0 ETH'
    if (num < 0.0001) return '<0.0001 ETH'
    return `${num.toFixed(4)} ETH`
  }

  if (!isConnected) {
    return (
      <div className="relative">
        <button
          onClick={connect}
          disabled={isConnecting}
          className={`
            ${compact ? 'btn-secondary' : 'btn-game'}
            flex items-center gap-2
            ${isConnecting ? 'opacity-50 cursor-wait' : ''}
          `}
        >
          {isConnecting ? (
            <>
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span className={compact ? 'text-xs' : ''}>Connecting...</span>
            </>
          ) : (
            <>
              <span className="text-lg">🦊</span>
              <span className={compact ? 'text-xs' : ''}>
                {!mounted ? 'Connect Wallet' : isMetaMaskInstalled() ? 'Connect Wallet' : 'Install MetaMask'}
              </span>
            </>
          )}
        </button>

        {error && (
          <div className="absolute top-full mt-2 right-0 w-64 p-3 bg-red-900/90 border border-red-500 rounded-lg text-xs text-red-200">
            {error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className={`
          ${compact ? 'px-2 py-1' : 'px-4 py-2'}
          bg-game-dark border border-game-border rounded-lg
          hover:border-game-primary transition-all
          flex items-center gap-2
        `}
      >
        {/* Status indicator */}
        <div className="w-2 h-2 bg-game-primary rounded-full animate-pulse" />

        {/* Address */}
        <span className={`font-mono ${compact ? 'text-xs' : 'text-sm'} text-game-primary`}>
          {formatAddress(address!)}
        </span>

        {/* Balance (hidden on compact) */}
        {!compact && (
          <span className="text-xs text-slate-400 border-l border-game-border pl-2">
            {formatBalance(balance)}
          </span>
        )}

        {/* Dropdown arrow */}
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />

          {/* Menu */}
          <div className="absolute top-full mt-2 right-0 w-64 bg-game-dark border border-game-border rounded-lg shadow-xl z-50 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-game-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-game-primary/20 rounded-full flex items-center justify-center">
                  <span className="text-xl">👨‍🌾</span>
                </div>
                <div>
                  <p className="font-mono text-sm text-white">
                    {formatAddress(address!)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatBalance(balance)}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(address!)
                  setShowDropdown(false)
                }}
                className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-game-border rounded-lg transition flex items-center gap-2"
              >
                <span>📋</span>
                Copy Address
              </button>

              <a
                href={`https://etherscan.io/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-game-border rounded-lg transition flex items-center gap-2 block"
              >
                <span>🔗</span>
                View on Explorer
              </a>

              <div className="border-t border-game-border my-2" />

              <button
                onClick={() => {
                  disconnect()
                  setShowDropdown(false)
                }}
                className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-900/30 rounded-lg transition flex items-center gap-2"
              >
                <span>🚪</span>
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
