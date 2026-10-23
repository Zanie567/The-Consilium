import { ARTICLES_CACHE_TAG } from './articleQueries'
import { expireCacheTag } from './cacheInvalidation'

/**
 * Bust every cached public article list (homepage grid, category pages,
 * archive) so a publish / unpublish / delete / restore is reflected
 * immediately instead of waiting out the time-based revalidation window.
 *
 * Call it only AFTER the mutation has committed, and AWAIT it before responding: the
 * returned promise settles once the expiry has been written to the cache, so the next
 * request (an editor reloading the page) reads fresh data. See cacheInvalidation.ts for
 * why that wait is explicit since Next 16.3. Never throws; resolves to false when the
 * invalidation could not be confirmed, so the caller can tell the administrator. It
 * also covers feed.xml and sitemap.xml, whose data is cached under the same tag
 * (see publicFeeds.ts), which refresh on their own within FEED_DATA_TTL_SECONDS anyway.
 */
export function revalidateArticleLists(): Promise<boolean> {
  return expireCacheTag(ARTICLES_CACHE_TAG)
}
