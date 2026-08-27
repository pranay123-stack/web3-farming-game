import { describe, expect, it } from 'vitest'
import { KeyedRateLimiter, TokenBucket } from '../src/lib/rateLimit'

describe('TokenBucket', () => {
  it('allows up to capacity, then throttles', () => {
    const bucket = new TokenBucket(3, 1, 0)
    expect(bucket.tryConsume(1, 0)).toBe(true)
    expect(bucket.tryConsume(1, 0)).toBe(true)
    expect(bucket.tryConsume(1, 0)).toBe(true)
    expect(bucket.tryConsume(1, 0)).toBe(false)
  })

  /**
   * Continuous refill is why this is a bucket and not a fixed window: a window
   * lets a client burst twice the limit across the boundary.
   */
  it('refills continuously rather than on a window boundary', () => {
    const bucket = new TokenBucket(2, 2, 0)
    expect(bucket.tryConsume(2, 0)).toBe(true)
    expect(bucket.tryConsume(1, 0)).toBe(false)
    expect(bucket.tryConsume(1, 500)).toBe(true) // 0.5s at 2/s = 1 token
  })

  it('never accumulates beyond capacity while idle', () => {
    const bucket = new TokenBucket(5, 10, 0)
    bucket.tryConsume(5, 0)
    expect(bucket.tryConsume(5, 60_000)).toBe(true)
    expect(bucket.tryConsume(1, 60_000)).toBe(false)
  })

  it('rejects a multi-token cost it cannot cover', () => {
    const bucket = new TokenBucket(3, 1, 0)
    expect(bucket.tryConsume(5, 0)).toBe(false)
    expect(bucket.available).toBe(3)
  })
})

describe('KeyedRateLimiter', () => {
  it('tracks each key independently', () => {
    const limiter = new KeyedRateLimiter(1, 0.1)
    expect(limiter.tryConsume('a', 1, 0)).toBe(true)
    expect(limiter.tryConsume('a', 1, 0)).toBe(false)
    expect(limiter.tryConsume('b', 1, 0)).toBe(true)
  })

  it('evicts idle keys so memory does not grow without bound', () => {
    const limiter = new KeyedRateLimiter(1, 1, 1000)
    limiter.tryConsume('a', 1, 0)
    limiter.tryConsume('b', 1, 0)
    expect(limiter.size).toBe(2)
    expect(limiter.evictStale(5000)).toBe(2)
    expect(limiter.size).toBe(0)
  })

  it('keeps keys that are still active', () => {
    const limiter = new KeyedRateLimiter(5, 1, 1000)
    limiter.tryConsume('a', 1, 0)
    limiter.tryConsume('a', 1, 4500)
    expect(limiter.evictStale(5000)).toBe(0)
    expect(limiter.size).toBe(1)
  })
})
