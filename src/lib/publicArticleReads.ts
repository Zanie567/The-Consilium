/**
 * Public-page reads that derive from articles but are not article lists: the series navigation on an article page,
 * the homepage's trending topics and the archive's topic filter. Each applies `publishedArticleWhere`, the one
 * visibility rule (published, not trashed, and not an article of an unpublished or deleted debate), so a topic or
 * series entry can never advertise an article the site itself will not serve. Extracted from the pages so the rule
 * is exercised against a real database (tests/integration/hidden-debate-public-reads-db.test.ts).
 */
import type { Prisma } from '@prisma/client'
import type { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'

/** The `series.articles` include on an article page: only articles a reader could open. */
export const SERIES_ARTICLES_ARGS = {
  where: publishedArticleWhere(),
  select: { id: true, title: true, slug: true, seriesOrder: true },
  orderBy: { seriesOrder: { sort: 'asc', nulls: 'last' } },
} satisfies Prisma.Series$articlesArgs

/** Tag rows on articles published in the last 30 days, with each article's view count, for the trending list. */
export function findTrendingTagRows(db: Pick<typeof prisma, 'articleTag'>, since: Date) {
  return db.articleTag.findMany({
    where: { article: publishedArticleWhere({ publishedAt: { gte: since } }) },
    include: { tag: true, article: { select: { viewCount: true } } },
  })
}

/** Topics with at least one public article (the archive's topic filter). */
export function findPublicTopics(db: Pick<typeof prisma, 'tag'>) {
  return db.tag.findMany({
    where: { articles: { some: { article: publishedArticleWhere() } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 1000,
  })
}
