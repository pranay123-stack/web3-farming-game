/**
 * Wire protocol shared by the game client and the multiplayer server.
 *
 * Kept in one file so a change to an event payload is a type error on both
 * sides rather than a silent runtime mismatch. The server re-exports these
 * types; the frontend imports them directly.
 *
 * Scope discipline: nothing here carries economic meaning. Positions, presence
 * and chat only. Ownership, balances, crops and trades live on-chain and are
 * never taken from a socket message.
 */

export const PROTOCOL_VERSION = 1

export interface PlayerPresence {
  /** Server-assigned session id. Not stable across reconnects. */
  id: string
  /** Verified wallet address, lowercase, or null for a guest. */
  address: string | null
  username: string
  x: number
  y: number
  zone: string
  isGuest: boolean
  /** Server clock, ms since epoch. */
  joinedAt: number
}

export interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  senderAddress: string | null
  content: string
  timestamp: number
  scope: ChatScope
  zone: string
}

export type ChatScope = 'global' | 'nearby' | 'system'

export interface AuthChallenge {
  nonce: string
  /** The exact string the client must sign. */
  message: string
  expiresAt: number
}

// --- client -> server -----------------------------------------------------

export interface ClientToServerEvents {
  /** Step 1 of wallet auth: ask for a nonce to sign. */
  'auth:challenge': (
    payload: { address: string },
    ack: (response: Result<AuthChallenge>) => void
  ) => void

  /** Step 2: present the signature. Server verifies it recovers to `address`. */
  'player:join': (
    payload: JoinPayload,
    ack: (response: Result<{ self: PlayerPresence; players: PlayerPresence[] }>) => void
  ) => void

  'player:move': (payload: MovePayload) => void
  'player:leave': () => void
  'chat:send': (payload: ChatSendPayload, ack?: (response: Result<{ id: string }>) => void) => void
  'players:sync': (ack: (response: Result<PlayerPresence[]>) => void) => void
  'heartbeat': (ack?: (serverTime: number) => void) => void
}

export interface JoinPayload {
  /** Omit for guest play. */
  address?: string
  /** Signature over the challenge message. Required when `address` is present. */
  signature?: string
  nonce?: string
  username?: string
  x?: number
  y?: number
}

export interface MovePayload {
  x: number
  y: number
  /** Facing, for remote animation. */
  facing?: Facing
  moving?: boolean
}

export type Facing = 'up' | 'down' | 'left' | 'right'

export interface ChatSendPayload {
  content: string
  scope: Exclude<ChatScope, 'system'>
}

// --- server -> client -----------------------------------------------------

export interface ServerToClientEvents {
  'player:joined': (player: PlayerPresence) => void
  'player:moved': (payload: { id: string; x: number; y: number; facing?: Facing; moving?: boolean }) => void
  'player:left': (payload: { id: string }) => void
  'players:snapshot': (players: PlayerPresence[]) => void
  'chat:message': (message: ChatMessage) => void
  'zone:changed': (payload: { id: string; zone: string }) => void
  'server:error': (payload: { code: ServerErrorCode; message: string }) => void
  'server:info': (payload: { onlineCount: number; serverTime: number }) => void
}

export type ServerErrorCode =
  | 'RATE_LIMITED'
  | 'INVALID_PAYLOAD'
  | 'AUTH_FAILED'
  | 'NOT_JOINED'
  | 'ALREADY_CONNECTED'
  | 'INTERNAL'

export type Result<T> = { ok: true; data: T } | { ok: false; code: ServerErrorCode; message: string }

// --- world constants ------------------------------------------------------

export const WORLD = {
  /** Tile dimensions of the shared map. */
  width: 64,
  height: 64,
  /** Manhattan radius, in tiles, for "nearby" chat. */
  nearbyRadius: 12,
  /** Zones are square blocks of this many tiles. */
  zoneSize: 16,
} as const

export const LIMITS = {
  maxChatLength: 280,
  maxUsernameLength: 24,
  /** Movement updates the server will accept per second. */
  moveRatePerSecond: 20,
  chatPerTenSeconds: 8,
  /** Max tiles a player may move in a single update before it is rejected. */
  maxMoveDelta: 6,
  heartbeatIntervalMs: 20_000,
  /** Sessions with no traffic for this long are reaped. */
  idleTimeoutMs: 90_000,
} as const

export function zoneIdForPosition(x: number, y: number): string {
  const zx = Math.floor(clampCoord(x) / WORLD.zoneSize)
  const zy = Math.floor(clampCoord(y) / WORLD.zoneSize)
  return `${zx}:${zy}`
}

export function clampCoord(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(WORLD.width - 1, Math.floor(value)))
}

/** The exact message a client signs to prove wallet ownership. */
export function buildAuthMessage(address: string, nonce: string): string {
  return [
    'Sign in to Web3 Farming Game',
    '',
    `Wallet: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    '',
    'This signature proves you own this wallet.',
    'It is free, and does not authorise any transaction.',
  ].join('\n')
}
