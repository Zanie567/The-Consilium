/**
 * rate-limiter.ts - simple in-memory rate limiter.
 *
 * Note: this is per-function-instance. On Vercel with multiple concurrent
 * instances it won't be perfectly consistent, but it provides meaningful
 * protection against single-client spam without requiring Upstash.
 */

interface Entry {
  count: number
  resetAt: number
}

const store = new Map<string, Entry>()

// Prune stale entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 5 * 60 * 1000)

/**
 * Returns true if the request is within the rate limit, false if it should
 * be rejected. Mutates the store on each call.
 *
 * @param key        Unique key - e.g. userId, IP, or a combination.
 * @param limit      Maximum number of requests allowed per window.
 * @param windowMs   Window duration in milliseconds.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const existing = store.get(key)

  if (!existing || now > existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= limit) return false
  existing.count++
  return true
}

/** Returns the number of seconds until the window resets for a key (0 if within limit). */
export function retryAfterSeconds(key: string): number {
  const entry = store.get(key)
  if (!entry) return 0
  const remaining = entry.resetAt - Date.now()
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0
}
