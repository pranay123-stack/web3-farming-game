'use client'

import { useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { shortAddress, formatEth } from '@/lib/format'
import { explorerAddressUrl } from '@/lib/chains'

/**
 * Wallet connection control.
 *
 * Handles every state the wallet can actually be in, each with the one action
 * that resolves it: no wallet installed, disconnected, connecting, wrong
 * network, connected.
 */
export function WalletConnect({ compact = false }: { compact?: boolean }) {
  const {
    status, address, chainId, chainName, nativeBalance, error,
    isConnected, isWrongNetwork, hasWallet, isDetecting, targetChain,
    connect, disconnect, switchNetwork,
  } = useWallet()

  const [menuOpen, setMenuOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // --- still looking for a provider ----------------------------------------
  // Rendered on the server and on the first client paint. Committing to
  // "install a wallet" here would flash that prompt at people who have one.
  if (isDetecting || hasWallet === null) {
    return (
      <button className="btn-secondary" disabled aria-busy="true">
        <Spinner />
        <span className="sr-only">Checking for a wallet</span>
        Wallet
      </button>
    )
  }

  // --- no wallet installed -------------------------------------------------
  if (status === 'unavailable' || (!hasWallet && status !== 'connecting')) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary"
      >
        <span aria-hidden>🦊</span>
        Install a wallet
      </a>
    )
  }

  // --- connecting ----------------------------------------------------------
  if (status === 'connecting') {
    return (
      <button className="btn-secondary" disabled>
        <Spinner />
        Connecting…
      </button>
    )
  }

  // --- disconnected --------------------------------------------------------
  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button onClick={() => void connect()} className="btn-primary">
          <span aria-hidden>🦊</span>
          Connect wallet
        </button>
        {error && <p className="max-w-[220px] text-right text-xs text-rose-500">{error}</p>}
      </div>
    )
  }

  // --- wrong network -------------------------------------------------------
  if (isWrongNetwork) {
    return (
      <button
        onClick={async () => {
          setSwitching(true)
          await switchNetwork()
          setSwitching(false)
        }}
        disabled={switching}
        className="btn-gold"
        title={`Connected to ${chainName}, but the game runs on ${targetChain.name}`}
      >
        {switching ? <Spinner /> : <span aria-hidden>⚠️</span>}
        Switch to {targetChain.shortName}
      </button>
    )
  }

  // --- connected -----------------------------------------------------------
  const explorer = address ? explorerAddressUrl(address, chainId ?? undefined) : null

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((open) => !open)}
        className="btn-secondary"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <span className="h-2 w-2 rounded-full bg-leaf-400" aria-hidden />
        <span className="tabular">{shortAddress(address)}</span>
        {!compact && (
          <span className="text-text-muted tabular">
            {formatEth(nativeBalance, 3)} ETH
          </span>
        )}
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="panel absolute right-0 z-50 mt-2 w-60 overflow-hidden p-1 shadow-xl"
          >
            <div className="border-b px-3 py-2" style={{ borderColor: 'var(--soil-700)' }}>
              <p className="heading">Connected</p>
              <p className="mt-1 break-all font-mono text-xs text-text-secondary">{address}</p>
              <p className="mt-2 text-xs text-text-muted">
                {chainName} · {formatEth(nativeBalance, 4)} ETH
              </p>
            </div>

            <button
              role="menuitem"
              onClick={() => {
                if (address) void navigator.clipboard?.writeText(address)
                setMenuOpen(false)
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-text-secondary hover:bg-soil-800 hover:text-text-primary"
            >
              Copy address
            </button>

            {explorer && (
              <a
                role="menuitem"
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-soil-800 hover:text-text-primary"
                onClick={() => setMenuOpen(false)}
              >
                View on explorer ↗
              </a>
            )}

            <button
              role="menuitem"
              onClick={() => {
                disconnect()
                setMenuOpen(false)
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-rose-500 hover:bg-soil-800"
            >
              Disconnect
            </button>

            {/* Being honest about what "disconnect" can actually do. */}
            <p className="px-3 pb-2 pt-1 text-[11px] leading-snug text-text-muted">
              Forgets your wallet in this tab. Revoke site access from your
              wallet to disconnect fully.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  )
}

export default WalletConnect
