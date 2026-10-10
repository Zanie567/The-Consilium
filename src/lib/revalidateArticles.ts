import { revalidateTag } from 'next/cache'
import { ARTICLES_CACHE_TAG } from './articleQueries'

/**
 * Bust every cached public article list (homepage grid, category pages,
 * archive) so a publish / unpublish / delete / restore is reflected
 * immediately instead of waiting out the time-based revalidation window.
 *
 * Safe to call from route handlers, server actions and cron handlers. Wrapped
 * in a try/catch so a revalidation hiccup can never turn a successful mutation
 * into a failed request. Call it only AFTER the mutation has committed, and
 * return its result to the user when staleness matters. It also covers feed.xml
 * and sitemap.xml, whose data is cached under the same tag (see publicFeeds.ts).
 */
export function revalidateArticleLists(): boolean {
  try {
    // updateTag is Server Action-only in Next 16. Route handlers and cron use
    // explicit expiration so the next list read waits for fresh public content.
    revalidateTag(ARTICLES_CACHE_TAG, { expire: 0 })
    return true
  } catch (err) {
    // Not silent: the caller learns it failed (and can tell the administrator). Public lists, the feed and the
    // sitemap still refresh on their own within FEED_DATA_TTL_SECONDS, so nothing stays stale indefinitely.
    console.error('[revalidateArticleLists] FAILED, public lists may be stale for up to the data-cache TTL:', err)
    return false
  }
}
