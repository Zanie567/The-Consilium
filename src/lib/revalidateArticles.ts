import { revalidatePath, revalidateTag } from 'next/cache'
import { ARTICLES_CACHE_TAG } from './articleQueries'
import { settleCacheInvalidations } from './cacheInvalidation'

/**
 * Bust every cached public view of articles so a publish / unpublish / delete / restore /
 * correction / byline change is reflected immediately instead of waiting out a time-based window:
 *
 * - the `articles` data-cache tag (homepage grid, category/tag lists, archive topics, feed.xml and
 *   sitemap.xml, see publicFeeds.ts), and
 * - every page cached at the CDN (ISR: article, category and tag pages, the static pages), through
 *   the root layout's path tag. Article pages read the database directly rather than through a
 *   tagged cache, so the path tag is what keeps a withdrawn or corrected article from being served
 *   from the CDN. Both expire at once (no stale copy is served): the next request renders fresh.
 *   Editorial mutations are rare, so expiring every public page costs one fresh render per page
 *   that is visited afterwards.
 *
 * Call it only AFTER the mutation has committed, and AWAIT it before responding: the returned
 * promise settles once the expiry has been written to the cache, so the next request (an editor
 * reloading the page) reads fresh data. See cacheInvalidation.ts for why that wait is explicit since
 * Next 16.3. Never throws; resolves to false when the invalidation could not be confirmed, so the
 * caller can tell the administrator. The page and data-cache TTLs still bound any staleness.
 */
export async function revalidateArticleLists(): Promise<boolean> {
  try {
    revalidateTag(ARTICLES_CACHE_TAG, { expire: 0 })
    revalidatePath('/', 'layout')
    await settleCacheInvalidations()
    return true
  } catch (err) {
    console.error('[cache] expiring public article caches FAILED; cached pages may be stale until their TTL:', err)
    return false
  }
}
