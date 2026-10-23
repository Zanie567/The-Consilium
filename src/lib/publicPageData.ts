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
