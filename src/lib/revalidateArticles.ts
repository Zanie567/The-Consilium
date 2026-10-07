import { revalidateTag } from 'next/cache'
import { ARTICLES_CACHE_TAG } from './articleQueries'

/**
 * Bust every cached public article list (homepage grid, category pages,
 * archive) so a publish / unpublish / delete / restore is reflected
 * immediately instead of waiting out the time-based revalidation window.
 *
 * Safe to call from route handlers, server actions and cron handlers. Wrapped
 * in a try/catch so a revalidation hiccup can never turn a successful mutation
 * into a failed request.
 */
export function revalidateArticleLists(): void {
  try {
    // Route handlers and cron cannot use updateTag in Next 16. Expire now so
    // unpublication never serves a stale public list on the following request.
    revalidateTag(ARTICLES_CACHE_TAG, { expire: 0 })
  } catch (err) {
    console.error('[revalidateArticleLists] failed:', err)
  }
}
