'use client'

import { useEffect, useState } from 'react'
import { useTransactions } from '@/hooks/useTransactions'
import type { TrackedTx } from '@/lib/state/txStore'

/**
 * Live transaction activity.
 *
 * The rule this component exists to enforce: a transaction is never shown as
 * successful until a receipt with status 1 has come back. Pending is pending,
 * and reverts are shown as reverts with the reason the contract gave.
 */

const STATUS_META: Record<TrackedTx['status'], { label: string; tone: string; icon: string }> = {
  preflight: { label: 'Checking', tone: 'text-text-muted', icon: '…' },
  signing: { label: 'Awaiting signature', tone: 'text-gold-400', icon: '✍' },
  pending: { label: 'Pending', tone: 'text-sky-500', icon: '◌' },
  confirmed: { label: 'Confirmed', tone: 'text-leaf-400', icon: '✓' },
  failed: { label: 'Failed', tone: 'text-rose-500', icon: '✕' },
  rejected: { label: 'Cancelled', tone: 'text-text-muted', icon: '⊘' },
}

export function TransactionFeed() {
  const { transactions, dismiss } = useTransactions()
  const visible = transactions.slice(0, 4)

  if (visible.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-label="Transaction activity"
    >
      {visible.map((tx) => (
        <TransactionToast key={tx.id} tx={tx} onDismiss={() => dismiss(tx.id)} />
      ))}
    </div>
  )
}

function TransactionToast({ tx, onDismiss }: { tx: TrackedTx; onDismiss: () => void }) {
  const meta = STATUS_META[tx.status]
  const isSettled = tx.status === 'confirmed' || tx.status === 'rejected'

  // Successful and cancelled toasts clear themselves; failures stay until the
  // player dismisses them, because they usually need reading.
  useEffect(() => {
    if (!isSettled) return
    const timer = setTimeout(onDismiss, tx.status === 'confirmed' ? 6000 : 4000)
    return () => clearTimeout(timer)
  }, [isSettled, tx.status, onDismiss])

  return (
    <div className="panel pointer-events-auto p-3 shadow-xl">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 text-sm ${meta.tone} ${tx.status === 'pending' ? 'animate-spin' : ''}`} aria-hidden>
          {meta.icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-text-primary">{tx.label}</p>
            <span className={`shrink-0 text-xs ${meta.tone}`}>{meta.label}</span>
          </div>

          {tx.error && (
            <div className="mt-1">
              <p className="text-xs font-medium text-rose-500">{tx.error.title}</p>
              {tx.error.detail && (
                <p className="mt-0.5 text-xs leading-snug text-text-secondary">{tx.error.detail}</p>
              )}
            </div>
          )}

          {tx.status === 'pending' && (
            <p className="mt-1 text-xs text-text-muted">
              Waiting for the network to confirm…
            </p>
          )}

          {tx.hash && (
            <div className="mt-1.5 flex items-center gap-2">
              <code className="truncate font-mono text-[11px] text-text-muted">
                {tx.hash.slice(0, 14)}…{tx.hash.slice(-6)}
              </code>
              {tx.explorerUrl && (
                <a
                  href={tx.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[11px] text-sky-500 hover:underline"
                >
                  View ↗
                </a>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-text-muted hover:bg-soil-800 hover:text-text-primary"
          aria-label={`Dismiss ${tx.label}`}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/** Compact pending indicator for the game header. */
export function PendingIndicator() {
  const { pendingCount } = useTransactions()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(pendingCount > 0)
  }, [pendingCount])

  if (!visible) return null

  return (
    <span className="chip border-sky-500/40 bg-sky-500/10 text-sky-500">
      <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" aria-hidden />
      {pendingCount} pending
    </span>
  )
}

export default TransactionFeed
