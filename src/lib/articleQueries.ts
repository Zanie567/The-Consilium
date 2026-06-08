import type { Prisma } from '@prisma/client'

/**
 * Cache tag for every public list of articles. Call `revalidateTag(ARTICLES_CACHE_TAG)`
 * after any mutation that changes what is published (publish, unpublish, delete,
 * restore) so cached homepage/category/archive lists refresh immediately instead
 * of waiting for the time-based revalidation window.
 */
export const ARTICLES_CACHE_TAG = 'articles'

/**
 * Time-based revalidation (seconds) for cached public article lists. Long enough
 * to absorb prefetch/navigation bursts without re-querying Postgres on every
 * request (Priority 2), short enough that content stays fresh even if a
 * tag-based revalidation is ever missed.
 */
export const ARTICLES_REVALIDATE_SECONDS = 30

/**
 * Single source of truth for "this article is publicly visible".
 *
 * An article is public when it is PUBLISHED and not soft-deleted. Nothing else.
 * Every public surface (homepage grid, category pages, archive, tag/author
 * pages, search, sitemap, RSS) must derive its filter from here so a published
 * article can never be visible in one place and silently missing from another.
 *
 * IMPORTANT — debate articles:
 *   Debate articles (`isDebate: true`) are ordinary published articles that
 *   belong to a category. They MUST still appear on their category page and in
 *   the archive — excluding them from category listings was the launch-blocker
 *   bug (Priority 1): /category/opinion showed 1 of 7 published articles. They
 *   are therefore NOT excluded in this shared helper.
 *   The homepage is the deliberate exception: both the oversized "featured" hero
 *   slot AND the general article feed (hero side column + grid) opt out via
 *   `publishedArticleWhere({ isDebate: false })`, because the homepage already
 *   surfaces the live debate through its dedicated DebatePanel and the
 *   /opinion-debate experience — listing each side again in the feed was
 *   redundant and read as duplicate cards.
 */
export const PUBLISHED_ARTICLE_WHERE = {
  status: 'PUBLISHED',
  deletedAt: null,
} as const satisfies Prisma.ArticleWhereInput

/**
 * Returns the canonical published-article filter, optionally narrowed with
 * additional constraints (category, author, tag, search terms, …). Callers
 * should always start from this rather than re-spelling `status`/`deletedAt`,
 * which is how the filters drifted out of sync in the first place.
 */
export function publishedArticleWhere(
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return { ...PUBLISHED_ARTICLE_WHERE, ...extra }
}
