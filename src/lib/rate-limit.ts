// In-memory rate limiter. Per-instance only - acceptable for a low-traffic
// site on Vercel where instances are short-lived and recycled frequently.

interface Entry {
  count: number
  resetAt: number
}

const store = new Map<string, Entry>()

// Prune expired entries every 5 minutes to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 5 * 60 * 1000).unref()

/**
 * Returns true if the request is allowed, false if it should be blocked.
 * @param key     Unique key (e.g. `contact:192.168.1.1`)
 * @param limit   Max requests allowed in the window
 * @param windowMs Time window in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  // Test affordance: the automated audit fires many requests per endpoint in
  // quick succession, which the in-memory limiter would (correctly) start
  // rejecting with 429. Set RATE_LIMIT_DISABLED=1 ONLY on the test server so
  // functional assertions are deterministic; the limiter's own logic is covered
  // by tests/unit/rate-limit.test.ts. Never set this in production.
  if (process.env.RATE_LIMIT_DISABLED === '1') return true

  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) return false

  entry.count++
  return true
}

/** Returns the number of seconds until the window resets for a key (0 if none/expired). */
export function retryAfterSeconds(key: string): number {
  const entry = store.get(key)
  if (!entry) return 0
  const remaining = entry.resetAt - Date.now()
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0
}

export function getIp(req: { headers: { get(key: string): string | null } }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}
