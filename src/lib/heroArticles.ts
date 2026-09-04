/**
 * Homepage hero rotation: which articles lead the homepage, and in what order.
 *
 * Eligibility is NOT decided here. The hero is fed by the homepage's existing
 * cached queries, both of which already derive their filter from
 * `publishedArticleWhere` — so an article can only reach this function if it is
 * PUBLISHED, not soft-deleted and not a debate side. Drafts, scheduled pieces
 * and trashed articles are excluded upstream, and stay excluded here because
 * this function never fetches: it only orders and caps what it is given.
 *
 * Ordering follows the editorial model the CMS already implements:
 *
 *   1. the explicitly featured article (the `isFeatured` star in the editorial
 *      portal, which the feature route keeps exclusive — setting it on one
 *      article clears it everywhere else), then
 *   2. the newest published articles, in the order the homepage query already
 *      returns them (`publishedAt` desc).
 *
 * `featured` is the homepage's existing `getFeaturedArticle()` result, which
 * already falls back to the newest published article when nothing is starred.
 * In that case step 1 and step 2 name the same article and the dedupe below
 * collapses them, leaving a plain newest-first rotation.
 */

/**
 * How many articles the hero rotates through. Three keeps the lead story
 * dominant and the cycle short enough to complete while a reader is still on
 * the page; the editorial model has exactly one featured slot, so a larger set
 * would be padding it out with ordinary recency.
 */
export const HERO_ROTATION_LIMIT = 3

/**
 * Orders the hero candidates and caps them at `limit`.
 *
 * Deterministic by construction — no randomness, no clock, no article identity
 * baked in — so the server render and the client hydration always agree, and a
 * newly published article enters (and pushes the oldest out of) the rotation on
 * its own as soon as the homepage's article cache refreshes.
 */
export function selectHeroArticles<T extends { id: string }>(
  featured: T | null | undefined,
  recent: readonly T[],
  limit: number = HERO_ROTATION_LIMIT,
): T[] {
  if (!featured) return recent.slice(0, limit)
  return [featured, ...recent.filter((article) => article.id !== featured.id)].slice(0, limit)
}
