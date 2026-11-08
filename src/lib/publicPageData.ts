import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { SERIES_ARTICLES_ARGS } from '@/lib/publicArticleReads'

// React cache only shares these reads within a render (including metadata).
// No cross-request cache: publishing, corrections and permissions stay current.
// A rejected query must propagate to the retryable error boundary; only a
// successful query returning null is evidence for a 404.
export const getPublicArticle = cache((slug: string) => prisma.article.findFirst({
  where: publishedArticleWhere({ slug }),
  include: {
    author: true,
    category: true,
    tags: { include: { tag: true } },
    series: { include: { articles: SERIES_ARTICLES_ARGS } },
  },
}))

export const getPublicCategory = cache((slug: string) =>
  prisma.category.findUnique({ where: { slug } }),
)

/** A tag and its 20 newest public articles (shared by metadata and the page within one render). */
export const getPublicTag = cache((slug: string) => prisma.tag.findUnique({
  where: { slug },
  include: {
    articles: {
      where: { article: publishedArticleWhere() },
      take: 20,
      orderBy: { article: { publishedAt: { sort: 'desc', nulls: 'last' } } },
      include: {
        article: {
          select: { id: true, title: true, slug: true, excerpt: true, coverImage: true, publishedAt: true, author: { select: { id: true, name: true, slug: true } }, category: { select: { name: true, slug: true } } },
        },
      },
    },
  },
}))
