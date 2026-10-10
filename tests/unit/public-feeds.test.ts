import { describe, it, expect, vi, beforeEach } from 'vitest'
const cache = await vi.hoisted(async () => (await import('../helpers/fakeNextCache')).createFakeNextCache())
vi.mock('next/cache', () => ({ unstable_cache: cache.unstable_cache, revalidateTag: cache.revalidateTag, revalidatePath: cache.revalidatePath }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  buildFeedXml, loadFeedItems, loadSitemapData, getCachedFeedItems, getCachedSitemapData,
  FEED_DATA_TTL_SECONDS, FEED_ITEM_LIMIT, FRESH_XML_CACHE_CONTROL, type FeedItem,
} from '@/lib/publicFeeds'
import { publishedArticleWhere, ARTICLES_CACHE_TAG } from '@/lib/articleQueries'
import { revalidateArticleLists } from '@/lib/revalidateArticles'

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  title: 'Tariffs & trade', slug: 'tariffs-trade', excerpt: 'About <tariffs>', publishedAt: '2026-10-01T09:00:00.000Z',
  authorName: 'Ada "A" Writer', category: 'Opinion & Debate', ...over,
})
const opts = { siteUrl: 'https://example.test', description: 'D', now: new Date('2026-10-10T12:00:00Z') }

describe('buildFeedXml', () => {
  it('renders one item per article with escaped, well-formed fields', () => {
    const xml = buildFeedXml([item()], opts)
    expect(xml).toContain('<link>https://example.test/articles/tariffs-trade</link>')
    expect(xml).toContain('<title><![CDATA[Tariffs & trade]]></title>')
    expect(xml).toContain('<author>Ada &quot;A&quot; Writer</author>')
    expect(xml).toContain('<category>Opinion &amp; Debate</category>')
    expect(xml).toContain('<pubDate>Thu, 01 Oct 2026 09:00:00 GMT</pubDate>')
    expect(xml).toContain('<lastBuildDate>Sat, 10 Oct 2026 12:00:00 GMT</lastBuildDate>')
    expect((xml.match(/<item>/g) ?? []).length).toBe(1)
  })
  it('is a valid, empty channel with no items, and survives a title that tries to close its CDATA', () => {
    expect(buildFeedXml([], opts)).not.toContain('<item>')
    expect(buildFeedXml([item({ title: 'x]]>y' })], opts)).toContain('<![CDATA[x]]]]><![CDATA[>y]]>')
    expect(buildFeedXml([item({ category: null, excerpt: null, authorName: null })], opts)).toContain('<author>The Consilium</author>')
  })
})

describe('what is public', () => {
  it('the feed and the sitemap both use the canonical visibility rule, including the hidden-debate exclusion', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await loadFeedItems({ article: { findMany } } as never)
    const where = findMany.mock.calls[0][0].where
    expect(where).toEqual(publishedArticleWhere({ publishedAt: { not: null } }))
    expect(where.forDebates).toBeDefined(); expect(where.againstDebates).toBeDefined()
    expect(findMany.mock.calls[0][0].take).toBe(FEED_ITEM_LIMIT)

    const article = { findMany: vi.fn().mockResolvedValue([]) }
    const tag = { findMany: vi.fn().mockResolvedValue([]) }
    await loadSitemapData({ article, category: { findMany: vi.fn().mockResolvedValue([]) }, tag, user: { findMany: vi.fn().mockResolvedValue([]) } } as never)
    expect(article.findMany.mock.calls[0][0].where).toEqual(publishedArticleWhere())
    // A topic used only by hidden articles is not advertised.
    expect(tag.findMany.mock.calls[0][0].where).toEqual({ articles: { some: { article: publishedArticleWhere() } } })
  })
  it('serialises dates as strings so cached values and fresh values look identical', async () => {
    const findMany = vi.fn().mockResolvedValue([{ title: 'T', slug: 's', excerpt: null, publishedAt: new Date('2026-10-01T09:00:00Z'), author: { name: 'A' }, category: null }])
    const items = await loadFeedItems({ article: { findMany } } as never)
    expect(items[0].publishedAt).toBe('2026-10-01T09:00:00.000Z')
    expect(await loadFeedItems({ article: { findMany: vi.fn().mockResolvedValue([{ title: 'T', slug: 's', excerpt: null, publishedAt: null, author: { name: 'A' }, category: null }]) } } as never)).toEqual([])
  })
})

describe('caching contract', () => {
  beforeEach(() => cache.reset())
  it('the XML is never cacheable by browsers or the CDN (nothing the invalidation cannot reach)', () => {
    expect(FRESH_XML_CACHE_CONTROL).toContain('max-age=0')
    expect(FRESH_XML_CACHE_CONTROL).toContain('s-maxage=0')
    expect(FRESH_XML_CACHE_CONTROL).toContain('must-revalidate')
    expect(FRESH_XML_CACHE_CONTROL).not.toMatch(/(?<!s-)max-age=[1-9]|s-maxage=[1-9]/)
  })
  it('data is cached under the shared articles tag, and a safety-net TTL bounds staleness', () => {
    expect(ARTICLES_CACHE_TAG).toBe('articles')
    expect(FEED_DATA_TTL_SECONDS).toBeGreaterThan(0)
    expect(FEED_DATA_TTL_SECONDS).toBeLessThanOrEqual(300)
  })
  it('a warmed cache is served until the articles tag is expired, then re-read', async () => {
    const findMany = vi.fn()
    const { prisma } = await import('@/lib/prisma')
    Object.assign(prisma, { article: { findMany } })
    findMany.mockResolvedValueOnce([{ title: 'Old', slug: 'old', excerpt: null, publishedAt: new Date('2026-10-01'), author: { name: 'A' }, category: null }])
    expect((await getCachedFeedItems()).map((i) => i.slug)).toEqual(['old'])
    findMany.mockResolvedValueOnce([]) // the article has since been removed
    expect((await getCachedFeedItems()).map((i) => i.slug)).toEqual(['old']) // warmed: still the cached copy
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(revalidateArticleLists()).toBe(true)
    expect(await getCachedFeedItems()).toEqual([]) // expired -> re-read
    expect(cache.stats.invalidations).toEqual(['articles'])
  })
  it('the safety-net TTL ends staleness even if invalidation never happens', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ title: 'Old', slug: 'old', excerpt: null, publishedAt: new Date('2026-10-01'), author: { name: 'A' }, category: null }]).mockResolvedValueOnce([])
    const { prisma } = await import('@/lib/prisma'); Object.assign(prisma, { article: { findMany } })
    const base = Date.now(); cache.clock.now = () => base
    await getCachedFeedItems()
    cache.clock.now = () => base + (FEED_DATA_TTL_SECONDS - 1) * 1000; expect((await getCachedFeedItems()).length).toBe(1)
    cache.clock.now = () => base + (FEED_DATA_TTL_SECONDS + 1) * 1000; expect(await getCachedFeedItems()).toEqual([])
    cache.clock.now = () => Date.now()
  })
  it('a failed database read is not cached, so an outage cannot pin an empty listing', async () => {
    const findMany = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([])
    const { prisma } = await import('@/lib/prisma'); Object.assign(prisma, { article: { findMany }, category: { findMany: vi.fn() }, tag: { findMany: vi.fn() }, user: { findMany: vi.fn() } })
    await expect(getCachedFeedItems()).rejects.toThrow('db down')
    await expect(getCachedFeedItems()).resolves.toEqual([]) // next request retries the database
    void getCachedSitemapData
  })
})

describe('invalidation failure is reported, never silent', () => {
  beforeEach(() => cache.reset())
  it('returns false and logs when the tag cannot be expired', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    cache.failInvalidations(true)
    expect(revalidateArticleLists()).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('FAILED'), expect.anything())
    log.mockRestore()
  })
})
