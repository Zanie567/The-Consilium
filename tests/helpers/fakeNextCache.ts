/**
 * A small, faithful stand-in for the parts of `next/cache` this app uses, for tests that run outside a Next
 * server: `unstable_cache` memoises per key set until its TTL or until one of its tags is expired, and
 * `revalidateTag(tag, { expire: 0 })` expires every entry with that tag, so the next read goes to the source.
 * It models OUR use of the cache (what is tagged, what is invalidated and when). That the real framework honours
 * it is proven separately against a production build (tests/e2e/wf-feed-invalidation.spec.ts).
 */
export function createFakeNextCache() {
  const entries = new Map<string, { value: unknown; tags: string[]; expiresAt: number }>()
  const stats = { hits: 0, misses: 0, invalidations: [] as string[] }
  let failInvalidation = false
  const clock = { now: () => Date.now() }
  return {
    stats,
    clock,
    /** Make the next `revalidateTag` calls throw, to test failure handling. */
    failInvalidations(on: boolean) { failInvalidation = on },
    reset() { entries.clear(); stats.hits = 0; stats.misses = 0; stats.invalidations.length = 0; failInvalidation = false },
    unstable_cache<T extends (...a: never[]) => Promise<unknown>>(fn: T, keys: string[], options: { tags?: string[]; revalidate?: number | false } = {}): T {
      const key = keys.join('|')
      return (async (...args: Parameters<T>) => {
        const hit = entries.get(key)
        if (hit && hit.expiresAt > clock.now()) { stats.hits++; return structuredClone(hit.value) }
        stats.misses++
        const value = await fn(...args) // a rejection is never cached
        const ttl = typeof options.revalidate === 'number' ? options.revalidate * 1000 : Number.POSITIVE_INFINITY
        // Real unstable_cache stores JSON: Dates come back as strings. Mirror that so loaders must not depend on Date objects.
        entries.set(key, { value: JSON.parse(JSON.stringify(value)), tags: options.tags ?? [], expiresAt: clock.now() + ttl })
        return JSON.parse(JSON.stringify(value))
      }) as T
    },
    revalidateTag(tag: string) {
      if (failInvalidation) throw new Error('simulated invalidation failure')
      stats.invalidations.push(tag)
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key)
    },
    revalidatePath() {},
  }
}
