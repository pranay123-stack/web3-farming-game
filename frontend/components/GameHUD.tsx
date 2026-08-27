'use client'

import Link from 'next/link'
import { useGameState } from '@/providers/GameStateProvider'
import { useWallet } from '@/hooks/useWallet'
import { WalletConnect } from './WalletConnect'
import { PendingIndicator } from './TransactionFeed'
import { formatToken } from '@/lib/format'

/**
 * The persistent top bar: currency, level and connection health.
 *
 * Every number here comes from a chain read. When a value is not yet known it
 * renders as a dash, never as a placeholder figure.
 */
export function GameHUD({ onlineCount, multiplayerStatus }: {
  onlineCount: number
  multiplayerStatus: string
}) {
  const { balances, profile, playerState } = useGameState()
  const { isConnected } = useWallet()

  const xpIntoLevel = profile ? profile.xp - profile.xpForCurrentLevel : 0n
  const xpSpan = profile ? profile.xpForNextLevel - profile.xpForCurrentLevel : 0n
  const xpPercent = profile && xpSpan > 0n
    ? Math.min(100, Number((xpIntoLevel * 100n) / xpSpan))
    : 0

  return (
    <header
      className="z-30 flex items-center justify-between gap-3 border-b bg-soil-900/95 px-3 py-2 backdrop-blur"
      style={{ borderColor: 'var(--soil-700)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 transition hover:opacity-80">
          <span className="text-xl" aria-hidden>🌾</span>
          <span className="hidden font-display text-sm font-semibold text-leaf-400 sm:block">
            Farmstead
          </span>
        </Link>

        {isConnected && (
          <>
            <div className="chip border-gold-500/40 bg-gold-500/10 text-gold-400">
              <span aria-hidden>🪙</span>
              <span className="tabular">
                {playerState === 'loading' && !balances ? '—' : formatToken(balances?.fgold)}
              </span>
              <span className="text-text-muted">FGOLD</span>
            </div>

            {profile && (
              <div className="hidden items-center gap-2 sm:flex" title={`${profile.xp} XP total`}>
                <span className="chip border-leaf-500/40 bg-leaf-500/10 text-leaf-300">
                  Lv {profile.level}
                </span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-soil-800">
                  <div
                    className="growth-bar h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${xpPercent}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <PendingIndicator />
        <MultiplayerBadge status={multiplayerStatus} onlineCount={onlineCount} />
        <WalletConnect compact />
      </div>
    </header>
  )
}

function MultiplayerBadge({ status, onlineCount }: { status: string; onlineCount: number }) {
  const tone =
    status === 'connected' ? 'border-leaf-500/40 bg-leaf-500/10 text-leaf-300'
    : status === 'reconnecting' || status === 'connecting' || status === 'authenticating'
      ? 'border-gold-500/40 bg-gold-500/10 text-gold-400'
      : 'border-soil-600 bg-soil-800 text-text-muted'

  const label =
    status === 'connected' ? `${Math.max(onlineCount, 1)} online`
    : status === 'reconnecting' ? 'Reconnecting'
    : status === 'connecting' || status === 'authenticating' ? 'Connecting'
    : status === 'disabled' ? 'Solo'
    : 'Offline'

  return (
    <span className={`chip hidden md:inline-flex ${tone}`} title={`Multiplayer: ${status}`}>
      <span
        className={`h-2 w-2 rounded-full ${
          status === 'connected' ? 'bg-leaf-400'
          : status === 'reconnecting' ? 'animate-pulse bg-gold-500'
          : 'bg-text-muted'
        }`}
        aria-hidden
      />
      {label}
    </span>
  )
}

export default GameHUD
