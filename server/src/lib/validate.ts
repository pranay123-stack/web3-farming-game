import { LIMITS, WORLD, type ChatScope, type Facing } from '../protocol'

/**
 * Runtime validation for every socket payload.
 *
 * Socket.IO deserialises whatever the client sent; nothing about the TypeScript
 * types is enforced at runtime. The old server read `payload.x` straight into
 * game state, so a client could send `Infinity`, `NaN`, an object or a huge
 * string and the server would happily broadcast it to everyone in the zone.
 */

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/
const NONCE_RE = /^[0-9a-f]{32}$/

export function validateAddress(value: unknown): Validated<string> {
  if (typeof value !== 'string') return { ok: false, reason: 'address must be a string' }
  if (!ADDRESS_RE.test(value)) return { ok: false, reason: 'address is not a valid 0x address' }
  return { ok: true, value: value.toLowerCase() }
}

export function validateSignature(value: unknown): Validated<string> {
  if (typeof value !== 'string') return { ok: false, reason: 'signature must be a string' }
  if (!SIGNATURE_RE.test(value)) return { ok: false, reason: 'signature is malformed' }
  return { ok: true, value }
}

export function validateNonce(value: unknown): Validated<string> {
  if (typeof value !== 'string') return { ok: false, reason: 'nonce must be a string' }
  if (!NONCE_RE.test(value)) return { ok: false, reason: 'nonce is malformed' }
  return { ok: true, value }
}

export function validateCoordinate(value: unknown, axis: 'x' | 'y'): Validated<number> {
  if (!isFiniteNumber(value)) return { ok: false, reason: `${axis} must be a finite number` }
  const limit = axis === 'x' ? WORLD.width : WORLD.height
  const floored = Math.floor(value)
  if (floored < 0 || floored >= limit) {
    return { ok: false, reason: `${axis} must be within 0..${limit - 1}` }
  }
  return { ok: true, value: floored }
}

const FACINGS: Facing[] = ['up', 'down', 'left', 'right']

export function validateFacing(value: unknown): Facing | undefined {
  return typeof value === 'string' && FACINGS.includes(value as Facing) ? (value as Facing) : undefined
}

export interface ValidMove {
  x: number
  y: number
  facing?: Facing
  moving: boolean
}

export function validateMovePayload(payload: unknown): Validated<ValidMove> {
  if (!isPlainObject(payload)) return { ok: false, reason: 'payload must be an object' }
  const x = validateCoordinate(payload.x, 'x')
  if (!x.ok) return x
  const y = validateCoordinate(payload.y, 'y')
  if (!y.ok) return y
  return {
    ok: true,
    value: {
      x: x.value,
      y: y.value,
      facing: validateFacing(payload.facing),
      moving: payload.moving === true,
    },
  }
}

export interface ValidJoin {
  address: string | null
  signature: string | null
  nonce: string | null
  username: string | null
  x: number
  y: number
}

export function validateJoinPayload(payload: unknown): Validated<ValidJoin> {
  if (!isPlainObject(payload)) return { ok: false, reason: 'payload must be an object' }

  let address: string | null = null
  let signature: string | null = null
  let nonce: string | null = null

  if (payload.address !== undefined && payload.address !== null) {
    const parsed = validateAddress(payload.address)
    if (!parsed.ok) return parsed
    address = parsed.value

    // A claimed address must come with proof. Guests may omit both.
    const sig = validateSignature(payload.signature)
    if (!sig.ok) return sig
    signature = sig.value

    const parsedNonce = validateNonce(payload.nonce)
    if (!parsedNonce.ok) return parsedNonce
    nonce = parsedNonce.value
  }

  let username: string | null = null
  if (payload.username !== undefined && payload.username !== null) {
    if (typeof payload.username !== 'string') {
      return { ok: false, reason: 'username must be a string' }
    }
    const trimmed = sanitizeText(payload.username, LIMITS.maxUsernameLength)
    username = trimmed.length > 0 ? trimmed : null
  }

  const x = payload.x === undefined ? { ok: true as const, value: 32 } : validateCoordinate(payload.x, 'x')
  if (!x.ok) return x
  const y = payload.y === undefined ? { ok: true as const, value: 32 } : validateCoordinate(payload.y, 'y')
  if (!y.ok) return y

  return { ok: true, value: { address, signature, nonce, username, x: x.value, y: y.value } }
}

export interface ValidChat {
  content: string
  scope: Exclude<ChatScope, 'system'>
}

export function validateChatPayload(payload: unknown): Validated<ValidChat> {
  if (!isPlainObject(payload)) return { ok: false, reason: 'payload must be an object' }
  if (typeof payload.content !== 'string') return { ok: false, reason: 'content must be a string' }

  const content = sanitizeText(payload.content, LIMITS.maxChatLength)
  if (content.length === 0) return { ok: false, reason: 'message is empty' }

  const scope = payload.scope
  if (scope !== 'global' && scope !== 'nearby') {
    return { ok: false, reason: 'scope must be "global" or "nearby"' }
  }

  return { ok: true, value: { content, scope } }
}

/**
 * Strips control characters, collapses whitespace and truncates.
 *
 * Output is plain text and is rendered as text by the client, never as HTML,
 * so this is defence in depth rather than the only barrier.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g

export function sanitizeText(input: string, maxLength: number): string {
  return input
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** Rejects a jump larger than the movement system could legitimately produce. */
export function isPlausibleMove(fromX: number, fromY: number, toX: number, toY: number): boolean {
  const dx = Math.abs(toX - fromX)
  const dy = Math.abs(toY - fromY)
  return dx <= LIMITS.maxMoveDelta && dy <= LIMITS.maxMoveDelta
}
