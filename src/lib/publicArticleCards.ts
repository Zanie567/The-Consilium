import type { Prisma } from '@prisma/client'
import { readTimeLabel } from '@/lib/readTime'

/**
 * The columns a public article card or homepage hero slide renders, and nothing else.
 *
 * Homepage and category lists are kept in the shared Next data cache, so their rows must
 * not carry the author's account (email, moderation and security columns), editorial
 * columns (notes, scores, schedule) or the article body. The body is read only to work
 * out the read-time label and is dropped before the row is cached.
 */
export const ARTICLE_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImage: true,
  publishedAt: true,
  content: true,
  author: { select: { name: true } },
  category: { select: { name: true, slug: true } },
} as const satisfies Prisma.ArticleSelect

type ArticleCardRow = Prisma.ArticleGetPayload<{ select: typeof ARTICLE_CARD_SELECT }>

export type ArticleCardData = Omit<ArticleCardRow, 'content' | 'publishedAt'> & {
  /** A Date when read directly; an ISO string after a round trip through the data cache. */
  publishedAt: Date | string | null
  readTime: string
}

export function toArticleCard({ content, ...card }: ArticleCardRow): ArticleCardData {
  return { ...card, readTime: readTimeLabel(content) }
}
