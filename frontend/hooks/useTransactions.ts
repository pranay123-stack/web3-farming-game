'use client'

import { useTxStore, txActions, selectPendingCount } from '@/lib/state/txStore'

export function useTransactions() {
  const transactions = useTxStore((s) => s.transactions)
  const pendingCount = useTxStore(selectPendingCount)

  return {
    transactions,
    pendingCount,
    isBusy: pendingCount > 0,
    dismiss: txActions.dismiss,
    clearSettled: txActions.clearSettled,
  }
}

export { runTransaction } from '@/lib/state/txStore'
export type { TrackedTx, TxStatus } from '@/lib/state/txStore'
