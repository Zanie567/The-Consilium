import { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { SITE_URL } from '@/lib/constants'

const BASE = SITE_URL

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories, tags, authors] = await Promise.all([
    prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
    }).catch(() => []),
    prisma.category.findMany({ select: { slug: true } }).catch(() => []),
    prisma.tag.findMany({ select: { slug: true } }).catch(() => []),
    prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] }, slug: { not: null }, NOT: { email: { startsWith: 'test-' } } },
      select: { slug: true },
    }).catch(() => []),
  ])

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/about`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/team`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/contact`, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${BASE}/corrections`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/archive`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/opinion-debate`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    // /search is deliberately absent: it is a client-rendered shell with no
    // server HTML to index, and is marked noindex in src/app/search/layout.tsx.
    // Listing a noindex URL here would just contradict the page itself.
  ]

  const articlePages: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${BASE}/articles/${a.slug}`,
    lastModified: a.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.9,
  }))

  const categoryPages: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${BASE}/category/${c.slug}`,
    changeFrequency: 'daily',
    priority: 0.7,
  }))

  const tagPages: MetadataRoute.Sitemap = tags.map((t) => ({
    url: `${BASE}/tag/${t.slug}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  const authorPages: MetadataRoute.Sitemap = authors
    .filter((a) => a.slug)
    .map((a) => ({
      url: `${BASE}/author/${a.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))

  return [...staticPages, ...articlePages, ...categoryPages, ...tagPages, ...authorPages]
}
