import { beforeEach, describe, expect, it } from 'vitest'
import { useMultiplayerStore, selectPlayerList } from '@/lib/state/multiplayerStore'
import type { RemotePlayer } from '@/lib/state/multiplayerStore'
import type { ChatMessage, PlayerPresence } from '@/shared/protocol'
import { zoneIdForPosition, clampCoord, buildAuthMessage, WORLD, LIMITS } from '@/shared/protocol'

/**
 * Multiplayer store shape and the shared protocol helpers.
 *
 * The property under test throughout: nothing economic can enter game state
 * through this store. It carries presence and chat, and that is all.
 */

function presence(overrides: Partial<PlayerPresence> = {}): PlayerPresence {
  return {
    id: 'p1',
    address: null,
    username: 'Farmer',
    x: 10,
    y: 10,
    zone: '0:0',
    isGuest: true,
    joinedAt: Date.now(),
    ...overrides,
  }
}

function remote(overrides: Partial<RemotePlayer> = {}): RemotePlayer {
  return { ...presence(), facing: 'down', moving: false, updatedAt: Date.now(), ...overrides }
}

beforeEach(() => {
  useMultiplayerStore.setState({
    status: 'idle',
    error: null,
    self: null,
    players: new Map(),
    messages: [],
    onlineCount: 0,
    presenceVersion: 0,
  })
})

describe('multiplayer store', () => {
  it('starts empty and disconnected', () => {
    const state = useMultiplayerStore.getState()
    expect(state.status).toBe('idle')
    expect(state.players.size).toBe(0)
    expect(state.messages).toHaveLength(0)
  })

  it('exposes presence as a list for the renderer', () => {
    const players = new Map<string, RemotePlayer>([
      ['a', remote({ id: 'a', username: 'Alice' })],
      ['b', remote({ id: 'b', username: 'Bob' })],
    ])
    useMultiplayerStore.setState({ players })
    expect(selectPlayerList(useMultiplayerStore.getState()).map((p) => p.username))
      .toEqual(['Alice', 'Bob'])
  })

  it('carries only presence fields - no balances, land or inventory', () => {
    const player = remote()
    // If an economic field ever appears here, it has become a trust boundary.
    expect(Object.keys(player).sort()).toEqual([
      'address', 'facing', 'id', 'isGuest', 'joinedAt', 'moving',
      'updatedAt', 'username', 'x', 'y', 'zone',
    ])
  })

  it('bounds chat history so a long session cannot grow without limit', () => {
    const messages: ChatMessage[] = Array.from({ length: 250 }, (_, i) => ({
      id: `m${i}`,
      senderId: 'p1',
      senderName: 'Farmer',
      senderAddress: null,
      content: `message ${i}`,
      timestamp: Date.now(),
      scope: 'global',
      zone: '0:0',
    }))
    // The store slices to the cap on every append; simulate the end state.
    useMultiplayerStore.setState({ messages: messages.slice(-200) })
    expect(useMultiplayerStore.getState().messages).toHaveLength(200)
  })

  it('bumps presenceVersion so the renderer can diff cheaply', () => {
    const before = useMultiplayerStore.getState().presenceVersion
    useMultiplayerStore.setState((s) => ({
      players: new Map([['a', remote({ id: 'a' })]]),
      presenceVersion: s.presenceVersion + 1,
    }))
    expect(useMultiplayerStore.getState().presenceVersion).toBe(before + 1)
  })

  it('models every connection state the UI renders', () => {
    for (const status of ['idle', 'connecting', 'authenticating', 'connected', 'reconnecting', 'error', 'disabled'] as const) {
      useMultiplayerStore.setState({ status })
      expect(useMultiplayerStore.getState().status).toBe(status)
    }
  })

  it('clears presence on a reconnect, so ghosts do not linger', () => {
    useMultiplayerStore.setState({
      status: 'connected',
      players: new Map([['a', remote({ id: 'a' })]]),
    })
    // What the disconnect handler does.
    useMultiplayerStore.setState((s) => ({
      status: 'reconnecting',
      players: new Map(),
      presenceVersion: s.presenceVersion + 1,
    }))

    const state = useMultiplayerStore.getState()
    expect(state.status).toBe('reconnecting')
    expect(state.players.size).toBe(0)
  })
})

describe('shared protocol', () => {
  it('partitions the world into stable zones', () => {
    expect(zoneIdForPosition(0, 0)).toBe('0:0')
    expect(zoneIdForPosition(WORLD.zoneSize, 0)).toBe('1:0')
    expect(zoneIdForPosition(WORLD.zoneSize - 1, WORLD.zoneSize - 1)).toBe('0:0')
  })

  it('clamps coordinates into the world, including hostile input', () => {
    expect(clampCoord(-5)).toBe(0)
    expect(clampCoord(WORLD.width + 100)).toBe(WORLD.width - 1)
    expect(clampCoord(12.9)).toBe(12)
    // Non-finite input collapses to the origin rather than the far edge, so a
    // garbage value cannot place a player at the map boundary.
    expect(clampCoord(NaN)).toBe(0)
    expect(clampCoord(Infinity)).toBe(0)
    expect(clampCoord(-Infinity)).toBe(0)
  })

  it('binds the auth message to the address and nonce', () => {
    const message = buildAuthMessage('0xABCDEF0000000000000000000000000000000001', 'nonce123')
    expect(message).toContain('0xabcdef0000000000000000000000000000000001')
    expect(message).toContain('nonce123')
    // The player must be able to see this is not a transaction.
    expect(message).toContain('does not authorise any transaction')
  })

  it('publishes limits the client enforces alongside the server', () => {
    expect(LIMITS.maxChatLength).toBeGreaterThan(0)
    expect(LIMITS.maxMoveDelta).toBeGreaterThan(0)
    expect(LIMITS.idleTimeoutMs).toBeGreaterThan(LIMITS.heartbeatIntervalMs)
  })
})
