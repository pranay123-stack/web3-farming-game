import { randomUUID } from 'crypto'
import {
  LIMITS, WORLD, zoneIdForPosition, type Facing, type PlayerPresence,
} from '../protocol'

/**
 * In-memory presence registry.
 *
 * Holds only ephemeral state - who is online and where they are standing.
 * Nothing here is authoritative for anything a player owns.
 */

export interface Session extends PlayerPresence {
  socketId: string
  facing: Facing
  moving: boolean
  lastSeen: number
}

export class PlayerRegistry {
  private bySocket = new Map<string, Session>()
  private byAddress = new Map<string, string>() // address -> socketId
  private zoneMembers = new Map<string, Set<string>>()

  create(params: {
    socketId: string
    address: string | null
    username: string | null
    x: number
    y: number
    now?: number
  }): Session {
    const now = params.now ?? Date.now()
    const x = clamp(params.x, WORLD.width)
    const y = clamp(params.y, WORLD.height)
    const zone = zoneIdForPosition(x, y)

    const session: Session = {
      id: randomUUID(),
      socketId: params.socketId,
      address: params.address,
      username: params.username ?? defaultUsername(params.address),
      x,
      y,
      zone,
      isGuest: params.address === null,
      joinedAt: now,
      facing: 'down',
      moving: false,
      lastSeen: now,
    }

    this.bySocket.set(params.socketId, session)
    if (session.address) this.byAddress.set(session.address, params.socketId)
    this.addToZone(zone, params.socketId)
    return session
  }

  remove(socketId: string): Session | null {
    const session = this.bySocket.get(socketId)
    if (!session) return null
    this.bySocket.delete(socketId)
    if (session.address) {
      // Only clear the index if it still points at this socket - a reconnect
      // may already have claimed it.
      if (this.byAddress.get(session.address) === socketId) {
        this.byAddress.delete(session.address)
      }
    }
    this.removeFromZone(session.zone, socketId)
    return session
  }

  get(socketId: string): Session | null {
    return this.bySocket.get(socketId) ?? null
  }

  socketIdForAddress(address: string): string | null {
    return this.byAddress.get(address.toLowerCase()) ?? null
  }

  /** Applies a validated move. Returns the previous zone when it changed. */
  move(
    socketId: string,
    x: number,
    y: number,
    facing: Facing | undefined,
    moving: boolean,
    now: number = Date.now()
  ): { session: Session; previousZone: string | null } | null {
    const session = this.bySocket.get(socketId)
    if (!session) return null

    session.x = clamp(x, WORLD.width)
    session.y = clamp(y, WORLD.height)
    if (facing) session.facing = facing
    session.moving = moving
    session.lastSeen = now

    const nextZone = zoneIdForPosition(session.x, session.y)
    if (nextZone === session.zone) return { session, previousZone: null }

    const previousZone = session.zone
    this.removeFromZone(previousZone, socketId)
    session.zone = nextZone
    this.addToZone(nextZone, socketId)
    return { session, previousZone }
  }

  touch(socketId: string, now: number = Date.now()): void {
    const session = this.bySocket.get(socketId)
    if (session) session.lastSeen = now
  }

  all(): Session[] {
    return [...this.bySocket.values()]
  }

  inZone(zone: string): Session[] {
    const members = this.zoneMembers.get(zone)
    if (!members) return []
    const sessions: Session[] = []
    for (const socketId of members) {
      const session = this.bySocket.get(socketId)
      if (session) sessions.push(session)
    }
    return sessions
  }

  /** Everyone within `radius` tiles (Chebyshev distance) of a point. */
  nearby(x: number, y: number, radius: number = WORLD.nearbyRadius): Session[] {
    return this.all().filter(
      (session) => Math.abs(session.x - x) <= radius && Math.abs(session.y - y) <= radius
    )
  }

  /** Drops sessions that have gone quiet, so ghosts do not accumulate. */
  reapIdle(now: number = Date.now()): Session[] {
    const reaped: Session[] = []
    for (const session of this.all()) {
      if (now - session.lastSeen > LIMITS.idleTimeoutMs) {
        const removed = this.remove(session.socketId)
        if (removed) reaped.push(removed)
      }
    }
    return reaped
  }

  get count(): number {
    return this.bySocket.size
  }

  get zoneCount(): number {
    return this.zoneMembers.size
  }

  toPresence(session: Session): PlayerPresence {
    return {
      id: session.id,
      address: session.address,
      username: session.username,
      x: session.x,
      y: session.y,
      zone: session.zone,
      isGuest: session.isGuest,
      joinedAt: session.joinedAt,
    }
  }

  reset(): void {
    this.bySocket.clear()
    this.byAddress.clear()
    this.zoneMembers.clear()
  }

  private addToZone(zone: string, socketId: string): void {
    let members = this.zoneMembers.get(zone)
    if (!members) {
      members = new Set()
      this.zoneMembers.set(zone, members)
    }
    members.add(socketId)
  }

  private removeFromZone(zone: string, socketId: string): void {
    const members = this.zoneMembers.get(zone)
    if (!members) return
    members.delete(socketId)
    if (members.size === 0) this.zoneMembers.delete(zone)
  }
}

function clamp(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(limit - 1, Math.floor(value)))
}

function defaultUsername(address: string | null): string {
  if (!address) return `Guest-${Math.floor(Math.random() * 9000 + 1000)}`
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
