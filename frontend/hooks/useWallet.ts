'use client'

import { useEffect } from 'react'
import {
  useWalletStore,
  walletActions,
  selectCanTransact,
  selectIsConnected,
  selectIsWrongNetwork,
} from '@/lib/state/walletStore'
import { TARGET_CHAIN, getChainInfo } from '@/lib/chains'

let restoreStarted = false

/** Test-only: allows the restore-once guard to be re-armed between cases. */
export function __resetRestoreGuard(): void {
  restoreStarted = false
}

/**
 * Wallet session state and actions.
 *
 * Every field is a primitive selected out of the store, and every action is a
 * module-level constant, so this hook returns a stable surface and can be
 * safely used inside dependency arrays.
 */
export function useWallet() {
  const status = useWalletStore((s) => s.status)
  const address = useWalletStore((s) => s.address)
  const chainId = useWalletStore((s) => s.chainId)
  const nativeBalance = useWalletStore((s) => s.nativeBalance)
  const provider = useWalletStore((s) => s.provider)
  const signer = useWalletStore((s) => s.signer)
  const error = useWalletStore((s) => s.error)
  const epoch = useWalletStore((s) => s.epoch)
  const walletDetected = useWalletStore((s) => s.walletDetected)

  const isConnected = useWalletStore(selectIsConnected)
  const isWrongNetwork = useWalletStore(selectIsWrongNetwork)
  const canTransact = useWalletStore(selectCanTransact)

  // Restore once per page load, silently. Guarded by a module flag so
  // remounting a consumer never re-triggers a wallet prompt.
  useEffect(() => {
    if (restoreStarted) return
    restoreStarted = true
    void walletActions.restore()
  }, [])

  return {
    status,
    address,
    chainId,
    chainName: chainId != null ? (getChainInfo(chainId)?.name ?? `Chain ${chainId}`) : null,
    nativeBalance,
    provider,
    signer,
    error,
    epoch,

    isConnected,
    isWrongNetwork,
    canTransact,
    /** null while detection is still pending, so the UI can stay neutral. */
    hasWallet: walletDetected,
    isDetecting: status === 'detecting',
    targetChain: TARGET_CHAIN,

    connect: walletActions.connect,
    disconnect: walletActions.disconnect,
    switchNetwork: walletActions.switchToTargetChain,
    refreshNativeBalance: walletActions.refreshNativeBalance,
  }
}
