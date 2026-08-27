import type { ContractTransactionResponse, TransactionReceipt } from 'ethers'
import { create } from 'zustand'
import { decodeTxError, type DecodedTxError } from '../errors'
import { explorerTxUrl } from '../chains'

/**
 * Lifecycle of a write transaction.
 *
 *   preflight -> signing -> pending -> confirmed
 *                              \-> failed
 *                   \-> rejected  (player declined)
 *                   \-> failed    (preflight caught it before signing)
 *
 * `confirmed` is only ever reached from a mined receipt with status 1. There
 * is no path from "submitted" straight to success, which is what the previous
 * client did - it awaited nothing and rendered a success state regardless of
 * whether the transaction reverted.
 */
export type TxStatus = 'preflight' | 'signing' | 'pending' | 'confirmed' | 'failed' | 'rejected'

export interface TrackedTx {
  id: string
  label: string
  status: TxStatus
  hash: string | null
  explorerUrl: string | null
  error: DecodedTxError | null
  createdAt: number
  updatedAt: number
  /** Set once mined; used to show block confirmations. */
  blockNumber: number | null
}

interface TxState {
  transactions: TrackedTx[]
}

export const useTxStore = create<TxState>(() => ({ transactions: [] }))

const MAX_TRACKED = 30
let counter = 0

function nextId(): string {
  counter += 1
  return `tx-${counter}-${Date.now()}`
}

function upsert(id: string, patch: Partial<TrackedTx>) {
  useTxStore.setState((state) => ({
    transactions: state.transactions.map((tx) =>
      tx.id === id ? { ...tx, ...patch, updatedAt: Date.now() } : tx
    ),
  }))
}

function push(tx: TrackedTx) {
  useTxStore.setState((state) => ({
    transactions: [tx, ...state.transactions].slice(0, MAX_TRACKED),
  }))
}

export const txActions = {
  dismiss(id: string) {
    useTxStore.setState((state) => ({
      transactions: state.transactions.filter((tx) => tx.id !== id),
    }))
  },
  clearSettled() {
    useTxStore.setState((state) => ({
      transactions: state.transactions.filter(
        (tx) => tx.status === 'pending' || tx.status === 'signing' || tx.status === 'preflight'
      ),
    }))
  },
}

export interface RunTransactionOptions {
  /** Shown in the activity feed, e.g. "Plant Wheat". */
  label: string
  /**
   * Runs before the wallet is opened. Throw here to stop with a clear message
   * instead of making the player sign something that will revert.
   */
  preflight?: () => Promise<void> | void
  /** Submits the transaction. */
  send: () => Promise<ContractTransactionResponse>
  /** Confirmations to wait for before reporting success. */
  confirmations?: number
  /** Runs after a successful receipt - the point where chain state is refetched. */
  onConfirmed?: (receipt: TransactionReceipt) => Promise<void> | void
  chainId?: number
}

export interface RunTransactionResult {
  ok: boolean
  receipt: TransactionReceipt | null
  error: DecodedTxError | null
  hash: string | null
}

/**
 * Drives one write transaction through its full lifecycle, keeping the
 * activity feed in sync at every step.
 *
 * Returns rather than throws, so callers can branch on `ok` without a
 * try/catch at every call site.
 */
export async function runTransaction(options: RunTransactionOptions): Promise<RunTransactionResult> {
  const { label, preflight, send, confirmations = 1, onConfirmed, chainId } = options
  const id = nextId()
  const now = Date.now()

  push({
    id,
    label,
    status: 'preflight',
    hash: null,
    explorerUrl: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    blockNumber: null,
  })

  // 1. Preflight -----------------------------------------------------------
  if (preflight) {
    try {
      await preflight()
    } catch (error) {
      const decoded = decodeTxError(error)
      upsert(id, { status: decoded.kind === 'rejected' ? 'rejected' : 'failed', error: decoded })
      return { ok: false, receipt: null, error: decoded, hash: null }
    }
  }

  // 2. Signature -----------------------------------------------------------
  upsert(id, { status: 'signing' })
  let response: ContractTransactionResponse
  try {
    response = await send()
  } catch (error) {
    const decoded = decodeTxError(error)
    upsert(id, { status: decoded.kind === 'rejected' ? 'rejected' : 'failed', error: decoded })
    return { ok: false, receipt: null, error: decoded, hash: null }
  }

  // 3. Pending -------------------------------------------------------------
  upsert(id, {
    status: 'pending',
    hash: response.hash,
    explorerUrl: explorerTxUrl(response.hash, chainId),
  })

  // 4. Confirmation --------------------------------------------------------
  let receipt: TransactionReceipt | null
  try {
    receipt = await response.wait(confirmations)
  } catch (error) {
    const decoded = decodeTxError(error)
    // A replacement that still succeeded is not a failure for the player.
    const replacement = (error as any)?.receipt as TransactionReceipt | undefined
    if (decoded.kind === 'replaced' && replacement?.status === 1) {
      upsert(id, {
        status: 'confirmed',
        hash: replacement.hash,
        blockNumber: replacement.blockNumber,
        explorerUrl: explorerTxUrl(replacement.hash, chainId),
      })
      if (onConfirmed) await safely(() => onConfirmed(replacement))
      return { ok: true, receipt: replacement, error: null, hash: replacement.hash }
    }
    upsert(id, { status: 'failed', error: decoded })
    return { ok: false, receipt: null, error: decoded, hash: response.hash }
  }

  if (!receipt || receipt.status !== 1) {
    const decoded: DecodedTxError = {
      kind: 'contract',
      title: 'Transaction reverted',
      detail: 'The transaction was mined but the game rejected it.',
      retryable: false,
    }
    upsert(id, { status: 'failed', error: decoded, blockNumber: receipt?.blockNumber ?? null })
    return { ok: false, receipt, error: decoded, hash: response.hash }
  }

  // 5. Success - refresh chain state before the UI claims anything changed.
  if (onConfirmed) await safely(() => onConfirmed(receipt as TransactionReceipt))

  upsert(id, { status: 'confirmed', blockNumber: receipt.blockNumber })
  return { ok: true, receipt, error: null, hash: response.hash }
}

async function safely(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
  } catch (error) {
    // A refresh failure must not turn a confirmed transaction into a failed
    // one; the transaction really did land.
    console.error('[tx] post-confirmation refresh failed', error)
  }
}

export const selectPendingCount = (s: TxState) =>
  s.transactions.filter((t) => t.status === 'pending' || t.status === 'signing').length

export const selectHasPending = (s: TxState) => selectPendingCount(s) > 0
