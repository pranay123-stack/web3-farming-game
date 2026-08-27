'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useWallet } from './useWallet'
import {
  MULTIPLAYER_ENABLED,
  multiplayerActions,
  useMultiplayerStore,
} from '@/lib/state/multiplayerStore'

/**
 * Read-only view of multiplayer state, plus the actions that do not manage the
 * connection.
 *
 * Any number of components may call this. It never opens or closes a socket,
 * so mounting a chat panel cannot tear down the session the game page owns.
 */
export function useMultiplayerState() {
  const status = useMultiplayerStore((s) => s.status)
  const error = useMultiplayerStore((s) => s.error)
  const self = useMultiplayerStore((s) => s.self)
  const messages = useMultiplayerStore((s) => s.messages)
  const onlineCount = useMultiplayerStore((s) => s.onlineCount)
  const presenceVersion = useMultiplayerStore((s) => s.presenceVersion)
  const playersMap = useMultiplayerStore((s) => s.players)

  const players = useMemo(() => [...playersMap.values()], [playersMap])

  const sendChat = useCallback(
    (content: string, scope: 'global' | 'nearby' = 'global') =>
      multiplayerActions.sendChat(content, scope),
    []
  )

  return {
    status,
    error,
    self,
    players,
    presenceVersion,
    messages,
    onlineCount,
    isConnected: status === 'connected',
    isGuest: self?.isGuest ?? true,
    enabled: MULTIPLAYER_ENABLED,
    sendChat,
    move: multiplayerActions.move,
    clearMessages: multiplayerActions.clearMessages,
  }
}

/**
 * Owns the multiplayer connection. Mount this in exactly ONE place - the game
 * page - and read state elsewhere with {useMultiplayerState}.
 *
 * Identity is proved, not asserted: the store asks the server for a nonce,
 * asks the wallet to sign it, and the server recovers the address from the
 * signature. Declining the signature falls back to guest presence rather than
 * locking the player out.
 */
export function useMultiplayerConnection(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const { address, signer, canTransact } = useWallet()
  const state = useMultiplayerState()

  // Hold the signer in a ref so the connect effect does not re-run (and
  // re-authenticate) every time ethers hands back a new signer object.
  const signerRef = useRef(signer)
  signerRef.current = signer

  const sign = useCallback(async (message: string) => {
    const active = signerRef.current
    if (!active) throw new Error('No signer available')
    return active.signMessage(message)
  }, [])

  useEffect(() => {
    if (!enabled || !MULTIPLAYER_ENABLED) return

    // Only present a wallet identity when it is actually usable; otherwise
    // join as a guest rather than claiming an address we cannot prove.
    const identity = canTransact && address ? address : null
    multiplayerActions.connect(identity, identity ? sign : undefined)

    return () => {
      multiplayerActions.disconnect()
    }
  }, [enabled, address, canTransact, sign])

  return state
}
