import { stripHtml } from '@/lib/content-filter'

/**
 * Upper bound on tags per article.
 *
 * Tag rows are upserted one at a time inside the article-save transaction, so
 * the length of this array sets how long that transaction holds open. Without a
 * cap, a request carrying hundreds of tags would run past the transaction
 * timeout and fail the whole save (Prisma P2028). Anything beyond this is
 * dropped rather than rejected: the editor UI offers no way to reach it, so a
 * request that does is malformed rather than a user with a lot to say.
 */
export const MAX_ARTICLE_TAGS = 25

/**
 * Transaction budget for an article save. Comfortably above the work involved
 * (one article write plus at most MAX_ARTICLE_TAGS upserts) and well under the
 * platform's function timeout, so a slow database surfaces as a real error
 * rather than a truncated transaction.
 */
export const ARTICLE_SAVE_TIMEOUT_MS = 15_000

export interface NormalizedTag {
  name: string
  slug: string
}

/**
 * Turns whatever arrived in a request body's `tags` field into a bounded list of
 * valid, unique tags. Non-strings, blanks and anything that slugs to nothing are
 * dropped, matching the behaviour the article routes had inline.
 */
export function normalizeArticleTags(tags: unknown): NormalizedTag[] {
  if (!Array.isArray(tags)) return []

  const bySlug = new Map<string, NormalizedTag>()
  for (const value of tags) {
    if (bySlug.size >= MAX_ARTICLE_TAGS) break
    if (typeof value !== 'string') continue
    const name = stripHtml(value).trim()
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (!name || !slug || bySlug.has(slug)) continue
    bySlug.set(slug, { name, slug })
  }
  return [...bySlug.values()]
}
