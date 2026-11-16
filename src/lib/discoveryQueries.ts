import type { Prisma } from '@prisma/client'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { escapeLikePattern } from '@/lib/searchText'

export const DISCOVERY_ARTICLE_SELECT = {
  id: true, title: true, slug: true, excerpt: true, coverImage: true, publishedAt: true,
  author: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
} satisfies Prisma.ArticleSelect

export function discoveryWhere(q?: string, categorySlug?: string, tags: string[] = []): Prisma.ArticleWhereInput {
  const term = q ? escapeLikePattern(q) : undefined
  return publishedArticleWhere({
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    // A merged tag's articles now carry the tag it was merged into, so an old ?tag=<slug> link
    // (or a bookmarked filter) matches through that tag rather than returning nothing.
    ...(tags.length ? { tags: { some: { tag: { OR: [{ slug: { in: tags } }, { mergedFrom: { some: { slug: { in: tags } } } }] } } } } : {}),
    ...(term ? { OR: [
      { title: { contains: term, mode: 'insensitive' } },
      { excerpt: { contains: term, mode: 'insensitive' } },
      { author: { name: { contains: term, mode: 'insensitive' } } },
      { tags: { some: { tag: { name: { contains: term, mode: 'insensitive' } } } } },
    ] } : {}),
  })
}
