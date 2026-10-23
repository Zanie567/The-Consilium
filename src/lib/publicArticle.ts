import type { Prisma } from '@prisma/client'

/**
 * The article columns an anonymous visitor may receive from the JSON API.
 *
 * This is the same allowlist the database grants the Data API's anon role
 * (supabase/migrations/20260408000100_restrict_column_grants.sql; a unit test keeps the two
 * in step). Everything else stays server-side: editorial notes and commendations,
 * engagement scores, schedule times, trash and hidden-by-debate markers, and any column
 * added to the model later. Spell out new public fields here deliberately.
 */
export const PUBLIC_ARTICLE_SELECT = {
  id: true,
  title: true,
  slug: true,
  content: true,
  excerpt: true,
  coverImage: true,
  categoryId: true,
  authorId: true,
  status: true,
  publishedAt: true,
  isFeatured: true,
  isPinned: true,
  corrected: true,
  correctionNote: true,
  viewCount: true,
  seriesId: true,
  seriesOrder: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ArticleSelect

export type PublicArticleColumn = keyof typeof PUBLIC_ARTICLE_SELECT

/** Copies only the public columns (plus the named, already-safe relations) from a loaded row. */
export function toPublicArticle<T extends Record<PublicArticleColumn, unknown>, R extends keyof T>(
  article: T,
  relations: readonly R[] = [],
): Pick<T, PublicArticleColumn | R> {
  const keys = [...(Object.keys(PUBLIC_ARTICLE_SELECT) as PublicArticleColumn[]), ...relations]
  return Object.fromEntries(keys.map((key) => [key, article[key]])) as Pick<T, PublicArticleColumn | R>
}
