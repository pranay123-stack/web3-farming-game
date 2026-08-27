import { randomUUID } from 'crypto'
import type { Server, Socket } from 'socket.io'
import {
  LIMITS, WORLD, type ChatMessage, type ClientToServerEvents, type PlayerPresence,
  type Result, type ServerErrorCode, type ServerToClientEvents,
} from '../protocol'
import { AuthService } from '../lib/auth'
import { PlayerRegistry } from '../game/PlayerRegistry'
import { KeyedRateLimiter, TokenBucket } from '../lib/rateLimit'
import {
  isPlausibleMove, validateChatPayload, validateJoinPayload, validateMovePayload, validateAddress,
} from '../lib/validate'
import type { Logger } from '../lib/logger'

export interface SocketData {
  joined: boolean
  moveBucket: TokenBucket
  chatBucket: TokenBucket
  joinBucket: TokenBucket
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

function fail(code: ServerErrorCode, message: string): Result<never> {
  return { ok: false, code, message }
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

/** Wraps an ack so a malformed client (no callback) cannot crash the handler. */
function safeAck<T>(ack: unknown, response: Result<T>): void {
  if (typeof ack === 'function') {
    try {
      ;(ack as (r: Result<T>) => void)(response)
    } catch {
      // Client-side ack threw; nothing to do.
    }
  }
}

export interface HandlerDeps {
  io: GameServer
  registry: PlayerRegistry
  auth: AuthService
  logger: Logger
  /** Per-IP challenge limiter, shared across sockets. */
  challengeLimiter: KeyedRateLimiter
}

export function registerSocketHandlers(deps: HandlerDeps): void {
  const { io, registry, auth, logger, challengeLimiter } = deps

  io.on('connection', (socket: GameSocket) => {
    const ip = clientIp(socket)
    const log = logger.child({ socketId: socket.id })

    socket.data.joined = false
    socket.data.moveBucket = new TokenBucket(LIMITS.moveRatePerSecond * 2, LIMITS.moveRatePerSecond)
    socket.data.chatBucket = new TokenBucket(LIMITS.chatPerTenSeconds, LIMITS.chatPerTenSeconds / 10)
    socket.data.joinBucket = new TokenBucket(5, 0.2)

    log.debug('socket connected', { ip })

    // ---------------------------------------------------------- auth step 1
    socket.on('auth:challenge', (payload, ack) => {
      if (!challengeLimiter.tryConsume(ip)) {
        safeAck(ack, fail('RATE_LIMITED', 'Too many sign-in attempts. Wait a moment.'))
        return
      }
      const address = validateAddress((payload as any)?.address)
      if (!address.ok) {
        safeAck(ack, fail('INVALID_PAYLOAD', address.reason))
        return
      }
      safeAck(ack, ok(auth.createChallenge(address.value)))
    })

    // ---------------------------------------------------------- auth step 2
    socket.on('player:join', (payload, ack) => {
      if (!socket.data.joinBucket.tryConsume()) {
        safeAck(ack, fail('RATE_LIMITED', 'Too many join attempts.'))
        return
      }
      if (socket.data.joined) {
        safeAck(ack, fail('ALREADY_CONNECTED', 'This socket has already joined.'))
        return
      }

      const parsed = validateJoinPayload(payload)
      if (!parsed.ok) {
        safeAck(ack, fail('INVALID_PAYLOAD', parsed.reason))
        return
      }
      const { address, signature, nonce, username, x, y } = parsed.value

      // A claimed wallet must be proven. Guests join with no address at all.
      if (address) {
        const verification = auth.verify(address, nonce!, signature!)
        if (!verification.ok) {
          log.warn('wallet verification failed', { address, reason: verification.reason })
          safeAck(ack, fail('AUTH_FAILED', verification.reason))
          return
        }

        // One live session per wallet: disconnect the stale one rather than
        // refusing the new one, so a refresh does not lock a player out.
        const existingSocketId = registry.socketIdForAddress(address)
        if (existingSocketId && existingSocketId !== socket.id) {
          const previous = io.sockets.sockets.get(existingSocketId)
          if (previous) {
            previous.emit('server:error', {
              code: 'ALREADY_CONNECTED',
              message: 'Your wallet connected from another tab.',
            })
            previous.disconnect(true)
          }
          handleLeave(deps, existingSocketId)
        }
      }

      const session = registry.create({ socketId: socket.id, address, username, x, y })
      socket.data.joined = true
      void socket.join(zoneRoom(session.zone))

      const presence = registry.toPresence(session)
      socket.to(zoneRoom(session.zone)).emit('player:joined', presence)
      broadcastSystemMessage(deps, session.zone, `${session.username} joined the farm.`)

      log.info('player joined', {
        playerId: session.id,
        address: session.address ?? 'guest',
        zone: session.zone,
      })

      safeAck(
        ack,
        ok({
          self: presence,
          players: registry.inZone(session.zone).map((s) => registry.toPresence(s)),
        })
      )

      socket.emit('server:info', { onlineCount: registry.count, serverTime: Date.now() })
    })

    // ------------------------------------------------------------ movement
    socket.on('player:move', (payload) => {
      const session = registry.get(socket.id)
      if (!session || !socket.data.joined) return

      if (!socket.data.moveBucket.tryConsume()) {
        // Silently drop: movement is high-frequency and a dropped frame is
        // invisible, whereas an error per frame would be a spam channel.
        return
      }

      const parsed = validateMovePayload(payload)
      if (!parsed.ok) {
        socket.emit('server:error', { code: 'INVALID_PAYLOAD', message: parsed.reason })
        return
      }

      const { x, y, facing, moving } = parsed.value
      if (!isPlausibleMove(session.x, session.y, x, y)) {
        // Snap the client back rather than accepting a teleport.
        socket.emit('player:moved', {
          id: session.id, x: session.x, y: session.y, facing: session.facing, moving: false,
        })
        return
      }

      const result = registry.move(socket.id, x, y, facing, moving)
      if (!result) return

      if (result.previousZone !== null) {
        void socket.leave(zoneRoom(result.previousZone))
        void socket.join(zoneRoom(session.zone))
        socket.to(zoneRoom(result.previousZone)).emit('player:left', { id: session.id })
        socket.to(zoneRoom(session.zone)).emit('player:joined', registry.toPresence(session))
        socket.emit('zone:changed', { id: session.id, zone: session.zone })
        socket.emit(
          'players:snapshot',
          registry.inZone(session.zone).filter((s) => s.socketId !== socket.id).map((s) => registry.toPresence(s))
        )
      }

      socket.to(zoneRoom(session.zone)).emit('player:moved', {
        id: session.id, x: session.x, y: session.y, facing: session.facing, moving: session.moving,
      })
    })

    // ---------------------------------------------------------------- chat
    socket.on('chat:send', (payload, ack) => {
      const session = registry.get(socket.id)
      if (!session || !socket.data.joined) {
        safeAck(ack, fail('NOT_JOINED', 'Join the game before chatting.'))
        return
      }
      if (!socket.data.chatBucket.tryConsume()) {
        safeAck(ack, fail('RATE_LIMITED', 'You are sending messages too quickly.'))
        socket.emit('server:error', { code: 'RATE_LIMITED', message: 'Slow down.' })
        return
      }

      const parsed = validateChatPayload(payload)
      if (!parsed.ok) {
        safeAck(ack, fail('INVALID_PAYLOAD', parsed.reason))
        return
      }

      registry.touch(socket.id)
      const message: ChatMessage = {
        id: randomUUID(),
        senderId: session.id,
        senderName: session.username,
        senderAddress: session.address,
        content: parsed.value.content,
        timestamp: Date.now(),
        scope: parsed.value.scope,
        zone: session.zone,
      }

      if (parsed.value.scope === 'global') {
        io.emit('chat:message', message)
      } else {
        // Nearby chat reaches whoever is actually within earshot, sender
        // included, regardless of zone boundaries.
        for (const recipient of registry.nearby(session.x, session.y, WORLD.nearbyRadius)) {
          io.to(recipient.socketId).emit('chat:message', message)
        }
      }

      log.debug('chat', { playerId: session.id, scope: message.scope })
      safeAck(ack, ok({ id: message.id }))
    })

    // ------------------------------------------------------------- syncing
    socket.on('players:sync', (ack) => {
      const session = registry.get(socket.id)
      if (!session) {
        safeAck(ack, fail('NOT_JOINED', 'Join the game first.'))
        return
      }
      registry.touch(socket.id)
      safeAck(
        ack,
        ok(registry.inZone(session.zone).filter((s) => s.socketId !== socket.id).map((s) => registry.toPresence(s)))
      )
    })

    socket.on('heartbeat', (ack) => {
      registry.touch(socket.id)
      if (typeof ack === 'function') {
        try { (ack as (t: number) => void)(Date.now()) } catch { /* ignore */ }
      }
    })

    socket.on('player:leave', () => {
      handleLeave(deps, socket.id)
      socket.data.joined = false
    })

    socket.on('disconnect', (reason) => {
      log.debug('socket disconnected', { reason })
      handleLeave(deps, socket.id)
    })

    socket.on('error', (error) => {
      log.warn('socket error', { error: String(error) })
    })
  })
}

function handleLeave(deps: HandlerDeps, socketId: string): void {
  const { io, registry, logger } = deps
  const session = registry.remove(socketId)
  if (!session) return

  io.to(zoneRoom(session.zone)).emit('player:left', { id: session.id })
  broadcastSystemMessage(deps, session.zone, `${session.username} left the farm.`)
  logger.info('player left', { playerId: session.id, zone: session.zone })
}

function broadcastSystemMessage(deps: HandlerDeps, zone: string, content: string): void {
  const message: ChatMessage = {
    id: randomUUID(),
    senderId: 'system',
    senderName: 'System',
    senderAddress: null,
    content,
    timestamp: Date.now(),
    scope: 'system',
    zone,
  }
  deps.io.to(zoneRoom(zone)).emit('chat:message', message)
}

export function zoneRoom(zone: string): string {
  return `zone:${zone}`
}

function clientIp(socket: GameSocket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  return socket.handshake.address || 'unknown'
}

/** Periodic maintenance: reap idle sessions and expired challenges. */
export function startMaintenance(deps: HandlerDeps): () => void {
  const interval = setInterval(() => {
    const reaped = deps.registry.reapIdle()
    for (const session of reaped) {
      deps.io.to(zoneRoom(session.zone)).emit('player:left', { id: session.id })
      deps.logger.info('reaped idle session', { playerId: session.id })
    }
    deps.auth.evictExpired()
    deps.challengeLimiter.evictStale()
  }, 30_000)

  // Do not hold the process open for the sake of a maintenance timer.
  if (typeof interval.unref === 'function') interval.unref()
  return () => clearInterval(interval)
}

export type { PlayerPresence }
