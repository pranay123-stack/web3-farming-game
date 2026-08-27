import { randomBytes } from 'crypto'
import { verifyMessage } from 'ethers'
import { buildAuthMessage, type AuthChallenge } from '../protocol'

/**
 * Wallet identity for the multiplayer service.
 *
 * The previous server took `payload.address` at face value, so anyone could
 * connect claiming to be any wallet - impersonating a player in chat, or
 * occupying their presence slot. Here a claimed address must be backed by a
 * signature over a server-issued, single-use nonce.
 *
 * What this proves: the socket controls that wallet's key.
 * What it deliberately does NOT do: grant any authority over game state.
 * Ownership, balances and trades are read from the chain; a verified address
 * is only ever used as a display identity and a presence key.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_OUTSTANDING_CHALLENGES = 10_000

interface StoredChallenge {
  address: string
  nonce: string
  expiresAt: number
}

export class AuthService {
  private challenges = new Map<string, StoredChallenge>()

  /** Issues a single-use nonce for `address` to sign. */
  createChallenge(address: string, now: number = Date.now()): AuthChallenge {
    this.evictExpired(now)

    // Bound memory against an unauthenticated challenge flood.
    if (this.challenges.size >= MAX_OUTSTANDING_CHALLENGES) {
      this.evictOldest(Math.floor(MAX_OUTSTANDING_CHALLENGES / 10))
    }

    const nonce = randomBytes(16).toString('hex')
    const expiresAt = now + CHALLENGE_TTL_MS
    this.challenges.set(nonce, { address: address.toLowerCase(), nonce, expiresAt })

    return {
      nonce,
      message: buildAuthMessage(address, nonce),
      expiresAt,
    }
  }

  /**
   * Verifies a signature against an outstanding challenge.
   *
   * The nonce is consumed whether or not verification succeeds, so a captured
   * signature cannot be replayed and a wrong guess cannot be retried against
   * the same nonce.
   */
  verify(
    address: string,
    nonce: string,
    signature: string,
    now: number = Date.now()
  ): { ok: true } | { ok: false; reason: string } {
    const stored = this.challenges.get(nonce)
    this.challenges.delete(nonce)

    if (!stored) return { ok: false, reason: 'Unknown or already-used nonce' }
    if (stored.expiresAt < now) return { ok: false, reason: 'Challenge expired' }

    const claimed = address.toLowerCase()
    if (stored.address !== claimed) return { ok: false, reason: 'Nonce was issued for a different address' }

    let recovered: string
    try {
      recovered = verifyMessage(buildAuthMessage(claimed, nonce), signature).toLowerCase()
    } catch {
      return { ok: false, reason: 'Signature could not be verified' }
    }

    if (recovered !== claimed) return { ok: false, reason: 'Signature does not match the claimed address' }
    return { ok: true }
  }

  evictExpired(now: number = Date.now()): number {
    let removed = 0
    for (const [nonce, challenge] of this.challenges) {
      if (challenge.expiresAt < now) {
        this.challenges.delete(nonce)
        removed++
      }
    }
    return removed
  }

  private evictOldest(count: number): void {
    let removed = 0
    for (const nonce of this.challenges.keys()) {
      if (removed >= count) break
      this.challenges.delete(nonce)
      removed++
    }
  }

  get outstandingCount(): number {
    return this.challenges.size
  }

  reset(): void {
    this.challenges.clear()
  }
}
