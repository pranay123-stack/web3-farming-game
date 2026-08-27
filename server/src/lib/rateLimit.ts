/**
 * Token-bucket rate limiter.
 *
 * Buckets refill continuously rather than resetting on a window boundary, so
 * a client cannot burst 2x the limit across a boundary. Used per-socket for
 * movement and chat, and per-IP for the HTTP surface.
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number = Date.now()
  ) {
    this.tokens = capacity
    this.lastRefill = now
  }

  /** Consumes one token. Returns false when the caller should be throttled. */
  tryConsume(cost = 1, now: number = Date.now()): boolean {
    this.refill(now)
    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }

  private refill(now: number): void {
    const elapsedSeconds = (now - this.lastRefill) / 1000
    if (elapsedSeconds <= 0) return
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond)
    this.lastRefill = now
  }

  get available(): number {
    return this.tokens
  }
}

/** Per-key buckets with lazy eviction, so idle keys do not leak memory. */
export class KeyedRateLimiter {
  private buckets = new Map<string, { bucket: TokenBucket; lastSeen: number }>()

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly evictAfterMs = 10 * 60 * 1000
  ) {}

  tryConsume(key: string, cost = 1, now: number = Date.now()): boolean {
    let entry = this.buckets.get(key)
    if (!entry) {
      entry = { bucket: new TokenBucket(this.capacity, this.refillPerSecond, now), lastSeen: now }
      this.buckets.set(key, entry)
    }
    entry.lastSeen = now
    return entry.bucket.tryConsume(cost, now)
  }

  evictStale(now: number = Date.now()): number {
    let removed = 0
    for (const [key, entry] of this.buckets) {
      if (now - entry.lastSeen > this.evictAfterMs) {
        this.buckets.delete(key)
        removed++
      }
    }
    return removed
  }

  get size(): number {
    return this.buckets.size
  }

  reset(): void {
    this.buckets.clear()
  }
}
