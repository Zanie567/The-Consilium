import { revalidateTag } from 'next/cache'
// Internal Next.js modules, pinned by version: scripts/backport-next-image-abort.mjs refuses any Next
// other than the reviewed one and verifies these exports exist (tests/unit/cache-invalidation.test.ts too).
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external'
import { executeRevalidates } from 'next/dist/server/revalidation-utils'

/**
 * Read-after-write for cached public data.
 *
 * `revalidateTag`/`revalidatePath` only QUEUE an invalidation on the current request. Next 16.2 held a
 * route handler's response open until the queue had been written to the cache; since 16.3 the queue is
 * handed to `waitUntil` and written AFTER the response is sent (`updateTag`, the supported
 * read-your-writes API, only works in Server Actions, and every mutation here is a Route Handler or a
 * cron job). Without this module, an editor who publishes, withdraws or trashes an article and
 * immediately reloads a list, the feed or the sitemap could still be served the previous version.
 *
 * `settleCacheInvalidations()` writes the queue now and waits for it, so the mutation's response is
 * not sent until the caches are updated, exactly as before. Next's own post-response write still runs
 * afterwards; repeating an expiry is harmless (at worst one extra cache miss).
 */
export async function settleCacheInvalidations(): Promise<void> {
  const store = workAsyncStorage.getStore()
  if (!store) return // outside a Next request (scripts, unit tests): nothing is queued
  const pending = executeRevalidates(store)
  if (pending) await pending
}

/**
 * Expire one cache tag and wait until the expiry is written. Never throws: returns false (and logs)
 * when the invalidation could not be confirmed. The data cache TTL still bounds any staleness.
 */
export async function expireCacheTag(tag: string): Promise<boolean> {
  try {
    revalidateTag(tag, { expire: 0 })
    await settleCacheInvalidations()
    return true
  } catch (err) {
    console.error(`[cache] expiring "${tag}" FAILED; cached data may be stale until its TTL:`, err)
    return false
  }
}
