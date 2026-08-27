import { describe, expect, it, beforeEach } from 'vitest'
import { Wallet } from 'ethers'
import { AuthService } from '../src/lib/auth'
import { buildAuthMessage } from '../src/protocol'

describe('AuthService', () => {
  let auth: AuthService
  let wallet: Wallet

  beforeEach(() => {
    auth = new AuthService()
    wallet = Wallet.createRandom() as unknown as Wallet
  })

  it('verifies a signature from the claimed wallet', async () => {
    const challenge = auth.createChallenge(wallet.address)
    const signature = await wallet.signMessage(challenge.message)
    expect(auth.verify(wallet.address, challenge.nonce, signature)).toEqual({ ok: true })
  })

  /**
   * The core of the identity fix. The previous server took the address on
   * trust, so any client could connect claiming to be any wallet.
   */
  it('rejects a signature produced by a different wallet', async () => {
    const victim = Wallet.createRandom()
    const attacker = Wallet.createRandom()
    const challenge = auth.createChallenge(victim.address)
    // The attacker signs the victim's exact challenge with their own key.
    const signature = await attacker.signMessage(challenge.message)

    expect(auth.verify(victim.address, challenge.nonce, signature).ok).toBe(false)
  })

  it('consumes the nonce, so a captured signature cannot be replayed', async () => {
    const challenge = auth.createChallenge(wallet.address)
    const signature = await wallet.signMessage(challenge.message)

    expect(auth.verify(wallet.address, challenge.nonce, signature).ok).toBe(true)
    expect(auth.verify(wallet.address, challenge.nonce, signature).ok).toBe(false)
  })

  it('consumes the nonce even on a failed attempt', async () => {
    const challenge = auth.createChallenge(wallet.address)
    const other = Wallet.createRandom()
    const badSignature = await other.signMessage(challenge.message)

    expect(auth.verify(wallet.address, challenge.nonce, badSignature).ok).toBe(false)
    // The real owner cannot reuse that nonce either - it is spent.
    const goodSignature = await wallet.signMessage(challenge.message)
    expect(auth.verify(wallet.address, challenge.nonce, goodSignature).ok).toBe(false)
  })

  it('rejects an unknown nonce', () => {
    const result = auth.verify(wallet.address, 'f'.repeat(32), '0x' + '1'.repeat(130))
    expect(result.ok).toBe(false)
  })

  it('rejects an expired challenge', async () => {
    const now = Date.now()
    const challenge = auth.createChallenge(wallet.address, now)
    const signature = await wallet.signMessage(challenge.message)
    const result = auth.verify(wallet.address, challenge.nonce, signature, now + 10 * 60 * 1000)
    expect(result.ok).toBe(false)
  })

  it('rejects a nonce that was issued for a different address', async () => {
    const other = Wallet.createRandom()
    const challenge = auth.createChallenge(other.address)
    const signature = await wallet.signMessage(challenge.message)
    expect(auth.verify(wallet.address, challenge.nonce, signature).ok).toBe(false)
  })

  it('rejects a garbage signature without throwing', () => {
    const challenge = auth.createChallenge(wallet.address)
    const result = auth.verify(wallet.address, challenge.nonce, '0x' + '0'.repeat(130))
    expect(result.ok).toBe(false)
  })

  it('binds the signed message to both address and nonce', () => {
    const message = buildAuthMessage(wallet.address, 'abc123')
    expect(message).toContain(wallet.address.toLowerCase())
    expect(message).toContain('abc123')
  })

  it('issues a distinct nonce every time', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      seen.add(auth.createChallenge(wallet.address).nonce)
    }
    expect(seen.size).toBe(50)
  })

  it('expires stale challenges to bound memory', () => {
    const now = Date.now()
    auth.createChallenge(wallet.address, now)
    auth.createChallenge(Wallet.createRandom().address, now)
    expect(auth.outstandingCount).toBe(2)
    expect(auth.evictExpired(now + 10 * 60 * 1000)).toBe(2)
    expect(auth.outstandingCount).toBe(0)
  })
})
