import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'net'
import { Wallet } from 'ethers'
import { io as createClient, type Socket } from 'socket.io-client'
import { buildServer, type BuiltServer } from '../src/app'
import type { AuthChallenge, PlayerPresence, Result } from '../src/protocol'

/**
 * Drives the real server over real sockets. These are the tests that prove the
 * connection lifecycle, wallet identity and validation actually hold end to
 * end, rather than just in the units underneath them.
 */

let server: BuiltServer
let port: number
const clients: Socket[] = []

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
  server = buildServer({ nodeEnv: 'test', logLevel: 'error' })
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, () => resolve())
  })
  port = (server.httpServer.address() as AddressInfo).port
})

afterEach(() => {
  while (clients.length > 0) {
    const client = clients.pop()
    client?.disconnect()
  }
  server.registry.reset()
  server.auth.reset()
})

afterAll(async () => {
  await server.shutdown()
})

function connect(): Socket {
  const client = createClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  })
  clients.push(client)
  return client
}

function waitConnected(client: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000)
    client.on('connect', () => { clearTimeout(timer); resolve() })
    client.on('connect_error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function emitWithAck<T>(client: Socket, event: string, payload?: unknown): Promise<Result<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), 5000)
    const handler = (response: Result<T>) => { clearTimeout(timer); resolve(response) }
    if (payload === undefined) client.emit(event, handler)
    else client.emit(event, payload, handler)
  })
}

function waitFor<T>(client: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), timeoutMs)
    client.once(event, (payload: T) => { clearTimeout(timer); resolve(payload) })
  })
}

/** Completes the full challenge/sign/join handshake for a wallet. */
async function joinAsWallet(client: Socket, wallet: Wallet, x = 32, y = 32) {
  const challengeResponse = await emitWithAck<AuthChallenge>(client, 'auth:challenge', {
    address: wallet.address,
  })
  if (!challengeResponse.ok) throw new Error(challengeResponse.message)
  const signature = await wallet.signMessage(challengeResponse.data.message)

  return emitWithAck<{ self: PlayerPresence; players: PlayerPresence[] }>(client, 'player:join', {
    address: wallet.address,
    signature,
    nonce: challengeResponse.data.nonce,
    x,
    y,
  })
}

describe('socket lifecycle', () => {
  it('accepts a guest join with no wallet', async () => {
    const client = connect()
    await waitConnected(client)
    const response = await emitWithAck<{ self: PlayerPresence }>(client, 'player:join', {
      username: 'Wanderer',
    })
    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.data.self.isGuest).toBe(true)
      expect(response.data.self.address).toBeNull()
    }
  })

  it('accepts a wallet join backed by a valid signature', async () => {
    const client = connect()
    await waitConnected(client)
    const wallet = Wallet.createRandom() as unknown as Wallet

    const response = await joinAsWallet(client, wallet)
    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.data.self.isGuest).toBe(false)
      expect(response.data.self.address).toBe(wallet.address.toLowerCase())
    }
  })

  /**
   * The impersonation test. Previously this succeeded, and the attacker
   * appeared to everyone as the victim's wallet.
   */
  it('refuses a wallet join signed by someone else', async () => {
    const client = connect()
    await waitConnected(client)
    const victim = Wallet.createRandom()
    const attacker = Wallet.createRandom()

    const challenge = await emitWithAck<AuthChallenge>(client, 'auth:challenge', {
      address: victim.address,
    })
    if (!challenge.ok) throw new Error('challenge failed')
    const forged = await attacker.signMessage(challenge.data.message)

    const response = await emitWithAck(client, 'player:join', {
      address: victim.address,
      signature: forged,
      nonce: challenge.data.nonce,
    })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.code).toBe('AUTH_FAILED')
  })

  it('refuses a wallet join with no signature at all', async () => {
    const client = connect()
    await waitConnected(client)
    const response = await emitWithAck(client, 'player:join', {
      address: '0x' + '1'.repeat(40),
    })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.code).toBe('INVALID_PAYLOAD')
  })

  it('refuses to reuse a nonce', async () => {
    const clientA = connect()
    await waitConnected(clientA)
    const wallet = Wallet.createRandom() as unknown as Wallet

    const challenge = await emitWithAck<AuthChallenge>(clientA, 'auth:challenge', {
      address: wallet.address,
    })
    if (!challenge.ok) throw new Error('challenge failed')
    const signature = await wallet.signMessage(challenge.data.message)

    const first = await emitWithAck(clientA, 'player:join', {
      address: wallet.address, signature, nonce: challenge.data.nonce,
    })
    expect(first.ok).toBe(true)

    const clientB = connect()
    await waitConnected(clientB)
    const replay = await emitWithAck(clientB, 'player:join', {
      address: wallet.address, signature, nonce: challenge.data.nonce,
    })
    expect(replay.ok).toBe(false)
  })

  it('rejects a second join on the same socket', async () => {
    const client = connect()
    await waitConnected(client)
    await emitWithAck(client, 'player:join', { username: 'One' })
    const second = await emitWithAck(client, 'player:join', { username: 'Two' })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('ALREADY_CONNECTED')
  })

  it('removes the player from presence on disconnect', async () => {
    const client = connect()
    await waitConnected(client)
    await emitWithAck(client, 'player:join', { username: 'Leaver' })
    expect(server.registry.count).toBe(1)

    client.disconnect()
    await new Promise((r) => setTimeout(r, 300))
    expect(server.registry.count).toBe(0)
  })

  it('lets a wallet reconnect, displacing the stale session', async () => {
    const wallet = Wallet.createRandom() as unknown as Wallet

    const first = connect()
    await waitConnected(first)
    expect((await joinAsWallet(first, wallet)).ok).toBe(true)

    const second = connect()
    await waitConnected(second)
    const rejoin = await joinAsWallet(second, wallet)

    expect(rejoin.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    // Exactly one live session for the wallet, not two.
    expect(server.registry.count).toBe(1)
  })
})

describe('presence and movement', () => {
  it('broadcasts a join to others in the zone', async () => {
    const alice = connect()
    await waitConnected(alice)
    await emitWithAck(alice, 'player:join', { username: 'Alice', x: 20, y: 20 })

    const bob = connect()
    await waitConnected(bob)
    const joined = waitFor<PlayerPresence>(alice, 'player:joined')
    await emitWithAck(bob, 'player:join', { username: 'Bob', x: 21, y: 21 })

    const presence = await joined
    expect(presence.username).toBe('Bob')
  })

  it('relays movement to other players', async () => {
    const alice = connect()
    await waitConnected(alice)
    await emitWithAck(alice, 'player:join', { username: 'Alice', x: 20, y: 20 })

    const bob = connect()
    await waitConnected(bob)
    await emitWithAck(bob, 'player:join', { username: 'Bob', x: 20, y: 21 })

    const moved = waitFor<{ x: number; y: number }>(alice, 'player:moved')
    bob.emit('player:move', { x: 21, y: 21, facing: 'right', moving: true })

    const update = await moved
    expect(update.x).toBe(21)
    expect(update.y).toBe(21)
  })

  /** A client that claims to have crossed the map gets snapped back. */
  it('rejects an implausible jump and corrects the client', async () => {
    const client = connect()
    await waitConnected(client)
    await emitWithAck(client, 'player:join', { username: 'Cheater', x: 5, y: 5 })

    const correction = waitFor<{ x: number; y: number }>(client, 'player:moved')
    client.emit('player:move', { x: 60, y: 60 })

    const snapped = await correction
    expect(snapped.x).toBe(5)
    expect(snapped.y).toBe(5)
    const session = server.registry.all()[0]
    expect(session.x).toBe(5)
  })

  it('reports an invalid movement payload rather than accepting it', async () => {
    const client = connect()
    await waitConnected(client)
    await emitWithAck(client, 'player:join', { username: 'Bad', x: 5, y: 5 })

    const error = waitFor<{ code: string }>(client, 'server:error')
    client.emit('player:move', { x: 'north', y: null })
    expect((await error).code).toBe('INVALID_PAYLOAD')
  })

  it('ignores movement from a socket that never joined', async () => {
    const client = connect()
    await waitConnected(client)
    client.emit('player:move', { x: 10, y: 10 })
    await new Promise((r) => setTimeout(r, 200))
    expect(server.registry.count).toBe(0)
  })

  it('returns a zone snapshot on request', async () => {
    const alice = connect()
    await waitConnected(alice)
    await emitWithAck(alice, 'player:join', { username: 'Alice', x: 20, y: 20 })

    const bob = connect()
    await waitConnected(bob)
    await emitWithAck(bob, 'player:join', { username: 'Bob', x: 21, y: 21 })

    const snapshot = await emitWithAck<PlayerPresence[]>(bob, 'players:sync')
    expect(snapshot.ok).toBe(true)
    if (snapshot.ok) {
      expect(snapshot.data.map((p) => p.username)).toContain('Alice')
      expect(snapshot.data.map((p) => p.username)).not.toContain('Bob')
    }
  })
})

describe('chat', () => {
  it('delivers a global message to everyone', async () => {
    const alice = connect()
    await waitConnected(alice)
    await emitWithAck(alice, 'player:join', { username: 'Alice', x: 1, y: 1 })

    const bob = connect()
    await waitConnected(bob)
    await emitWithAck(bob, 'player:join', { username: 'Bob', x: 60, y: 60 })

    const received = new Promise<{ content: string }>((resolve) => {
      bob.on('chat:message', (message: { content: string; scope: string }) => {
        if (message.scope === 'global') resolve(message)
      })
    })
    alice.emit('chat:send', { content: 'hello world', scope: 'global' })
    expect((await received).content).toBe('hello world')
  })

  it('keeps nearby chat within earshot', async () => {
    const alice = connect()
    await waitConnected(alice)
    await emitWithAck(alice, 'player:join', { username: 'Alice', x: 5, y: 5 })

    const farAway = connect()
    await waitConnected(farAway)
    await emitWithAck(farAway, 'player:join', { username: 'Distant', x: 60, y: 60 })

    let distantHeard = false
    farAway.on('chat:message', (message: { scope: string }) => {
      if (message.scope === 'nearby') distantHeard = true
    })

    await emitWithAck(alice, 'chat:send', { content: 'psst', scope: 'nearby' })
    await new Promise((r) => setTimeout(r, 400))
    expect(distantHeard).toBe(false)
  })

  it('refuses chat from a socket that never joined', async () => {
    const client = connect()
    await waitConnected(client)
    const response = await emitWithAck(client, 'chat:send', { content: 'hi', scope: 'global' })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.code).toBe('NOT_JOINED')
  })

  it('rejects a malformed chat payload', async () => {
    const client = connect()
    await waitConnected(client)
    await emitWithAck(client, 'player:join', { username: 'Alice' })
    const response = await emitWithAck(client, 'chat:send', { content: 12345, scope: 'global' })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.code).toBe('INVALID_PAYLOAD')
  })

  it('rate limits a chat flood', async () => {
    const client = connect()
    await waitConnected(client)
    await emitWithAck(client, 'player:join', { username: 'Spammer' })

    let limited = false
    for (let i = 0; i < 20; i++) {
      const response = await emitWithAck(client, 'chat:send', {
        content: `message ${i}`, scope: 'global',
      })
      if (!response.ok && response.code === 'RATE_LIMITED') {
        limited = true
        break
      }
    }
    expect(limited).toBe(true)
  })

  it('truncates an oversized message instead of relaying it', async () => {
    const client = connect()
    await waitConnected(client)
    await emitWithAck(client, 'player:join', { username: 'Verbose' })

    const received = waitFor<{ content: string }>(client, 'chat:message')
    client.emit('chat:send', { content: 'x'.repeat(5000), scope: 'global' })
    const message = await received
    expect(message.content.length).toBeLessThanOrEqual(280)
  })
})

describe('http surface', () => {
  it('serves health with player counts', async () => {
    const response = await fetch(`http://localhost:${port}/health`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(typeof body.players).toBe('number')
  })

  it('serves liveness and readiness separately', async () => {
    expect((await fetch(`http://localhost:${port}/health/live`)).status).toBe(200)
    expect((await fetch(`http://localhost:${port}/health/ready`)).status).toBe(200)
  })

  it('exposes aggregate stats without a player roster', async () => {
    const response = await fetch(`http://localhost:${port}/stats`)
    const body = await response.json()
    expect(typeof body.onlinePlayers).toBe('number')
    // The old /players route leaked a live roster of who was online.
    expect(body.players).toBeUndefined()
  })

  it('has no /players route at all', async () => {
    const response = await fetch(`http://localhost:${port}/players`)
    expect(response.status).toBe(404)
  })

  it('returns JSON, not an HTML stack trace, for unknown routes', async () => {
    const response = await fetch(`http://localhost:${port}/nope`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
