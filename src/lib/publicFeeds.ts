/**
 * Data behind the two machine-readable public listings, `feed.xml` and `sitemap.xml`.
 *
 * Why this exists (found on hosted staging): `feed.xml` was sent with `s-maxage=3600`, so a CDN could keep
 * serving a removed article's title and excerpt for an hour, and `sitemap.xml` was a statically cached route
 * nothing revalidated. `revalidatePath` cannot fix that: for a Route Handler it only invalidates data the
 * handler read through the Next data cache, and "marks the path for revalidation", it does not purge a
 * response cached by a Cache-Control header.
 *
 * So the rule here is the one the rest of the site already follows:
 *   1. The DATA is cached under the shared `articles` tag with a short TTL (a safety net: even if an
 *      invalidation fails, nothing stays stale longer than FEED_DATA_TTL_SECONDS).
 *   2. Every mutation that can change public visibility expires that tag AFTER its commit
 *      (`revalidateArticleLists`), so the next request re-reads the database.
 *   3. The XML responses themselves are not cacheable by browsers or the CDN, so there is no copy
 *      the invalidation cannot reach. The cost is one cheap cache lookup per request.
 *
 * Visibility always comes from `publishedArticleWhere`, the same canonical rule as every other public list,
 * which also excludes articles of an unpublished or deleted debate even if their own status is wrong.
 */
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { ARTICLES_CACHE_TAG, publishedArticleWhere } from '@/lib/articleQueries'

/** Upper bound on staleness if tag invalidation ever fails. */
export const FEED_DATA_TTL_SECONDS = 300
export const FEED_ITEM_LIMIT = 20

export interface FeedItem {
  title: string
  slug: string
  excerpt: string | null
  publishedAt: string
  authorName: string | null
  category: string | null
}

export interface SitemapData {
  articles: { slug: string; updatedAt: string }[]
  categories: { slug: string }[]
  tags: { slug: string }[]
  authors: { slug: string }[]
}

type Db = Pick<typeof prisma, 'article' | 'category' | 'tag' | 'user'>

export async function loadFeedItems(db: Db = prisma): Promise<FeedItem[]> {
  const articles = await db.article.findMany({
    where: publishedArticleWhere({ publishedAt: { not: null } }),
    orderBy: { publishedAt: 'desc' },
    take: FEED_ITEM_LIMIT,
    include: { author: true, category: true },
  })
  return articles.flatMap((a) =>
    a.publishedAt
      ? [{ title: a.title, slug: a.slug, excerpt: a.excerpt, publishedAt: a.publishedAt.toISOString(), authorName: a.author.name, category: a.category?.name ?? null }]
      : [],
  )
}

export async function loadSitemapData(db: Db = prisma): Promise<SitemapData> {
  const [articles, categories, tags, authors] = await Promise.all([
    db.article.findMany({
      where: publishedArticleWhere(),
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
    }),
    db.category.findMany({ select: { slug: true } }),
    // Only topics that still have a public article: a topic used solely by hidden articles must not be advertised.
    db.tag.findMany({ where: { articles: { some: { article: publishedArticleWhere() } } }, select: { slug: true } }),
    db.user.findMany({
      where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] }, slug: { not: null }, NOT: { email: { startsWith: 'test-' } } },
      select: { slug: true },
    }),
  ])
  return {
    articles: articles.map((a) => ({ slug: a.slug, updatedAt: a.updatedAt.toISOString() })),
    categories,
    tags,
    authors: authors.flatMap((u) => (u.slug ? [{ slug: u.slug }] : [])),
  }
}

// A rejected promise is never cached by unstable_cache, so a database failure cannot pin an empty listing.
export const getCachedFeedItems = unstable_cache(() => loadFeedItems(), ['public-feed-items-v1'], {
  tags: [ARTICLES_CACHE_TAG],
  revalidate: FEED_DATA_TTL_SECONDS,
})
export const getCachedSitemapData = unstable_cache(() => loadSitemapData(), ['public-sitemap-data-v1'], {
  tags: [ARTICLES_CACHE_TAG],
  revalidate: FEED_DATA_TTL_SECONDS,
})

// ── RSS rendering (pure) ────────────────────────────────────────────────────

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const cdata = (value: string) => `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`

export function buildFeedXml(items: FeedItem[], opts: { siteUrl: string; description: string; now?: Date }): string {
  const rendered = items
    .map((item) => {
      const link = `${opts.siteUrl}/articles/${item.slug}`
      return `<item>
  <title>${cdata(item.title)}</title>
  <link>${escapeXml(link)}</link>
  <guid isPermaLink="true">${escapeXml(link)}</guid>
  <description>${cdata(item.excerpt ?? '')}</description>
  <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>
  <author>${escapeXml(item.authorName ?? 'The Consilium')}</author>
  ${item.category ? `<category>${escapeXml(item.category)}</category>` : ''}
</item>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>The Consilium</title>
  <link>${opts.siteUrl}</link>
  <description>${opts.description}</description>
  <language>en-gb</language>
  <lastBuildDate>${(opts.now ?? new Date()).toUTCString()}</lastBuildDate>
${rendered}
</channel>
</rss>`
}

/**
 * Headers for every machine-readable listing. Browsers and shared caches must ask the origin each time
 * (`max-age=0` + `s-maxage=0`); the origin answers from the tagged data cache above, which is what gets invalidated.
 */
export const FRESH_XML_CACHE_CONTROL = 'public, max-age=0, s-maxage=0, must-revalidate'
