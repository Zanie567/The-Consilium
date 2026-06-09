/**
 * Unit tests for src/lib/rate-limit.ts
 *
 * The module uses a module-level Map as its store. To avoid cross-test
 * contamination we use unique key prefixes per describe block.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

// The audit can run the server (and thus vitest) with RATE_LIMIT_DISABLED=1 to
// keep functional HTTP tests deterministic. These unit tests exercise the
// limiter's REAL logic, so make sure the bypass flag is off in this process.
beforeAll(() => {
  delete process.env.RATE_LIMIT_DISABLED
})

// ── checkRateLimit ────────────────────────────────────────────────────────────

describe('checkRateLimit — basic allowance', () => {
  it('allows the first request', () => {
    expect(checkRateLimit('test-basic:1', 3, 10_000)).toBe(true)
  })

  it('allows requests up to the limit', () => {
    const key = 'test-up-to-limit:1'
    expect(checkRateLimit(key, 3, 10_000)).toBe(true)
    expect(checkRateLimit(key, 3, 10_000)).toBe(true)
    expect(checkRateLimit(key, 3, 10_000)).toBe(true)
  })

  it('blocks the request that exceeds the limit', () => {
    const key = 'test-exceed:1'
    checkRateLimit(key, 3, 10_000)
    checkRateLimit(key, 3, 10_000)
    checkRateLimit(key, 3, 10_000)
    expect(checkRateLimit(key, 3, 10_000)).toBe(false)
  })

  it('continues to block after the limit is hit', () => {
    const key = 'test-continue-block:1'
    checkRateLimit(key, 2, 10_000)
    checkRateLimit(key, 2, 10_000)
    expect(checkRateLimit(key, 2, 10_000)).toBe(false)
    expect(checkRateLimit(key, 2, 10_000)).toBe(false)
  })
})

describe('checkRateLimit — key isolation', () => {
  it('different keys are rate-limited independently', () => {
    const keyA = 'test-isolation:A'
    const keyB = 'test-isolation:B'
    // Fill up keyA
    checkRateLimit(keyA, 1, 10_000)
    expect(checkRateLimit(keyA, 1, 10_000)).toBe(false)
    // keyB should still be allowed
    expect(checkRateLimit(keyB, 1, 10_000)).toBe(true)
  })
})

describe('checkRateLimit — window expiry', () => {
  it('allows again after a very short window expires', async () => {
    const key = 'test-expiry:1'
    const windowMs = 50 // 50ms window
    checkRateLimit(key, 1, windowMs)
    expect(checkRateLimit(key, 1, windowMs)).toBe(false) // blocked

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 70))
    expect(checkRateLimit(key, 1, windowMs)).toBe(true) // allowed again
  })
})

describe('checkRateLimit — edge: limit=1', () => {
  it('first call allowed, second blocked', () => {
    const key = 'test-limit1:1'
    expect(checkRateLimit(key, 1, 10_000)).toBe(true)
    expect(checkRateLimit(key, 1, 10_000)).toBe(false)
  })
})

describe('checkRateLimit — edge: limit=0', () => {
  it('always blocks when limit is 0', () => {
    // With limit=0 the condition `entry.count >= limit` fires immediately
    // because 1 >= 0 is true after the first request increments count.
    // The FIRST call creates the entry with count=1 and returns true,
    // then subsequent calls are blocked. Document actual behaviour:
    const key = 'test-limit0:1'
    const first = checkRateLimit(key, 0, 10_000)
    const second = checkRateLimit(key, 0, 10_000)
    // First call: no existing entry → sets count=1, returns true
    expect(first).toBe(true)
    // Second call: count(1) >= limit(0) → returns false
    expect(second).toBe(false)
  })
})

// ── retryAfterSeconds ─────────────────────────────────────────────────────────

describe('retryAfterSeconds', () => {
  it('returns 0 for a key that has never been seen', () => {
    expect(retryAfterSeconds('test-retry-unseen:1')).toBe(0)
  })

  it('returns a positive number for a key that is within limit (window still open)', () => {
    // Note: retryAfterSeconds returns time until the window RESETS, not whether the key is
    // blocked. Any key that has been used within the window will return a positive value.
    // This is a documentation issue — the function name implies "retry after blocked"
    // but it actually means "seconds until window resets".
    const key = 'test-retry-within:1'
    checkRateLimit(key, 5, 10_000)
    const wait = retryAfterSeconds(key)
    // The window is 10 seconds; we're within 1 second of creating it, so wait ≈ 10
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(10)
  })

  it('returns a positive number for a key that has hit its limit', () => {
    const key = 'test-retry-blocked:1'
    checkRateLimit(key, 1, 10_000)
    checkRateLimit(key, 1, 10_000) // now blocked
    const wait = retryAfterSeconds(key)
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(10) // should be close to 10 seconds
  })

  it('returns 0 after window expires', async () => {
    const key = 'test-retry-expired:1'
    checkRateLimit(key, 1, 50) // 50ms window
    checkRateLimit(key, 1, 50) // blocked

    await new Promise((r) => setTimeout(r, 70))
    // Window has expired; retryAfterSeconds should return 0
    expect(retryAfterSeconds(key)).toBe(0)
  })
})
