import { io, type Socket } from 'socket.io-client'
import { create } from 'zustand'
import type {
  AuthChallenge, ChatMessage, ClientToServerEvents, PlayerPresence, Result,
  ServerToClientEvents, Facing,
} from '@/shared/protocol'
import { LIMITS } from '@/shared/protocol'

/**
 * Multiplayer presence and chat.
 *
 * Scope discipline: this store never carries anything economic. Balances,
 * crops, land and trades come from the chain. What arrives over the socket is
 * where other players are standing and what they said, and nothing else can
 * enter game state through it.
 *
 * Wallet identity is proved, not asserted: the client requests a nonce, asks
 * the wallet to sign it, and the server recovers the address from the
 * signature. Guests may connect with no address at all.
 */

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'disabled'

const MAX_CHAT_HISTORY = 200

export interface RemotePlayer extends PlayerPresence {
  facing: Facing
  moving: boolean
  /** Local timestamp of the last update, for interpolation and staleness. */
  updatedAt: number
}

interface MultiplayerState {
  status: ConnectionStatus
  error: string | null
  self: PlayerPresence | null
  players: Map<string, RemotePlayer>
  messages: ChatMessage[]
  onlineCount: number
  /** Incremented on every presence change, so Phaser can diff cheaply. */
  presenceVersion: number
}

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const INITIAL: MultiplayerState = {
  status: 'idle',
  error: null,
  self: null,
  players: new Map(),
  messages: [],
  onlineCount: 0,
  presenceVersion: 0,
}

export const useMultiplayerStore = create<MultiplayerState>(() => ({ ...INITIAL }))

let socket: TypedSocket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let currentIdentity: { address: string | null } = { address: null }
let signMessage: ((message: string) => Promise<string>) | null = null

export const SERVER_URL =
  process.env.NEXT_PUBLIC_MULTIPLAYER_URL ?? 'http://localhost:3001'

export const MULTIPLAYER_ENABLED =
  process.env.NEXT_PUBLIC_MULTIPLAYER_ENABLED !== 'false'

function bumpPresence(mutate: (players: Map<string, RemotePlayer>) => void) {
  useMultiplayerStore.setState((state) => {
    const players = new Map(state.players)
    mutate(players)
    return { players, presenceVersion: state.presenceVersion + 1 }
  })
}

function toRemote(presence: PlayerPresence): RemotePlayer {
  return { ...presence, facing: 'down', moving: false, updatedAt: Date.now() }
}

function ackToPromise<T>(emit: (ack: (r: Result<T>) => void) => void, timeoutMs = 10_000): Promise<Result<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, code: 'INTERNAL', message: 'Server did not respond in time.' }),
      timeoutMs
    )
    emit((response) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

/** Completes the challenge/sign/join handshake for the current identity. */
async function performJoin(): Promise<void> {
  if (!socket) return
  const activeSocket = socket
  useMultiplayerStore.setState({ status: 'authenticating' })

  const { address } = currentIdentity
  let joinPayload: Record<string, unknown> = { x: 32, y: 32 }

  if (address && signMessage) {
    const challenge = await ackToPromise<AuthChallenge>((ack) =>
      activeSocket.emit('auth:challenge', { address }, ack)
    )
    if (!challenge.ok) {
      useMultiplayerStore.setState({ status: 'error', error: challenge.message })
      return
    }
    try {
      const signature = await signMessage(challenge.data.message)
      joinPayload = { ...joinPayload, address, signature, nonce: challenge.data.nonce }
    } catch {
      // Declining the signature is a legitimate choice - fall back to guest
      // presence rather than blocking the player out of multiplayer.
      joinPayload = { ...joinPayload }
    }
  }

  const joined = await ackToPromise<{ self: PlayerPresence; players: PlayerPresence[] }>((ack) =>
    activeSocket.emit('player:join', joinPayload as never, ack)
  )

  if (!joined.ok) {
    useMultiplayerStore.setState({ status: 'error', error: joined.message })
    return
  }

  const players = new Map<string, RemotePlayer>()
  for (const presence of joined.data.players) {
    if (presence.id !== joined.data.self.id) players.set(presence.id, toRemote(presence))
  }

  useMultiplayerStore.setState((state) => ({
    status: 'connected',
    error: null,
    self: joined.data.self,
    players,
    presenceVersion: state.presenceVersion + 1,
  }))
}

function attachHandlers(activeSocket: TypedSocket): void {
  activeSocket.on('connect', () => {
    void performJoin()
  })

  activeSocket.on('disconnect', (reason) => {
    useMultiplayerStore.setState((state) => ({
      // Socket.IO retries on its own for transport-level drops; an explicit
      // server or client disconnect is terminal.
      status: reason === 'io client disconnect' ? 'idle' : 'reconnecting',
      players: new Map(),
      presenceVersion: state.presenceVersion + 1,
    }))
  })

  activeSocket.on('connect_error', (error) => {
    useMultiplayerStore.setState({
      status: 'reconnecting',
      error: error.message || 'Could not reach the multiplayer server.',
    })
  })

  activeSocket.io.on('reconnect_attempt', () => {
    useMultiplayerStore.setState({ status: 'reconnecting' })
  })

  activeSocket.on('player:joined', (presence) => {
    bumpPresence((players) => { players.set(presence.id, toRemote(presence)) })
  })

  activeSocket.on('player:left', ({ id }) => {
    bumpPresence((players) => { players.delete(id) })
  })

  activeSocket.on('player:moved', ({ id, x, y, facing, moving }) => {
    bumpPresence((players) => {
      const existing = players.get(id)
      if (!existing) return
      players.set(id, {
        ...existing,
        x, y,
        facing: facing ?? existing.facing,
        moving: moving ?? false,
        updatedAt: Date.now(),
      })
    })
  })

  activeSocket.on('players:snapshot', (snapshot) => {
    const selfId = useMultiplayerStore.getState().self?.id
    bumpPresence((players) => {
      players.clear()
      for (const presence of snapshot) {
        if (presence.id !== selfId) players.set(presence.id, toRemote(presence))
      }
    })
  })

  activeSocket.on('chat:message', (message) => {
    useMultiplayerStore.setState((state) => ({
      messages: [...state.messages, message].slice(-MAX_CHAT_HISTORY),
    }))
  })

  activeSocket.on('zone:changed', ({ zone }) => {
    useMultiplayerStore.setState((state) => ({
      self: state.self ? { ...state.self, zone } : state.self,
    }))
  })

  activeSocket.on('server:info', ({ onlineCount }) => {
    useMultiplayerStore.setState({ onlineCount })
  })

  activeSocket.on('server:error', ({ code, message }) => {
    if (code === 'ALREADY_CONNECTED') {
      useMultiplayerStore.setState({ status: 'error', error: message })
    }
  })
}

export const multiplayerActions = {
  /**
   * Opens (or re-opens) the connection.
   *
   * @param address Verified wallet to present, or null to join as a guest.
   * @param sign Wallet signing function; omit for guest play.
   */
  connect(address: string | null, sign?: (message: string) => Promise<string>): void {
    if (!MULTIPLAYER_ENABLED) {
      useMultiplayerStore.setState({ status: 'disabled' })
      return
    }

    const identityChanged = currentIdentity.address !== address
    currentIdentity = { address }
    signMessage = sign ?? null

    if (socket && socket.connected && !identityChanged) return

    if (socket && identityChanged) {
      // Re-authenticate from scratch rather than mutating an existing session.
      multiplayerActions.disconnect()
    }

    if (!socket) {
      useMultiplayerStore.setState({ status: 'connecting', error: null })
      socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10_000,
        timeout: 10_000,
        autoConnect: true,
      }) as TypedSocket
      attachHandlers(socket)

      heartbeatTimer = setInterval(() => {
        socket?.emit('heartbeat')
      }, LIMITS.heartbeatIntervalMs)
    } else if (!socket.connected) {
      socket.connect()
    }
  },

  disconnect(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (socket) {
      socket.removeAllListeners()
      socket.io.removeAllListeners()
      socket.disconnect()
      socket = null
    }
    currentIdentity = { address: null }
    signMessage = null
    useMultiplayerStore.setState({ ...INITIAL })
  },

  move(x: number, y: number, facing: Facing, moving: boolean): void {
    if (!socket?.connected) return
    if (useMultiplayerStore.getState().status !== 'connected') return
    socket.emit('player:move', { x, y, facing, moving })
  },

  async sendChat(content: string, scope: 'global' | 'nearby'): Promise<Result<{ id: string }>> {
    if (!socket?.connected) {
      return { ok: false, code: 'INTERNAL', message: 'Not connected to the multiplayer server.' }
    }
    const activeSocket = socket
    return ackToPromise<{ id: string }>((ack) =>
      activeSocket.emit('chat:send', { content, scope }, ack)
    )
  },

  clearMessages(): void {
    useMultiplayerStore.setState({ messages: [] })
  },
} as const

export const selectPlayerList = (state: MultiplayerState) => [...state.players.values()]
