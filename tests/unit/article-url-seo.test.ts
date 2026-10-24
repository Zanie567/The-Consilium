/**
 * Every public surface names an article by its CURRENT address: canonical tag, Open Graph URL, share
 * links, RSS and the sitemap. A retired address (an old slug with a 301) is never advertised anywhere,
 * because none of them read article_slug_redirects: they all read articles.slug.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const { sitemapData, publicArticle } = vi.hoisted(() => ({
  sitemapData: vi.fn(),
  publicArticle: vi.fn(),
}))
vi.mock('@/lib/publicFeeds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/publicFeeds')>()),
  getCachedSitemapData: sitemapData,
}))
vi.mock('@/lib/publicPageData', () => ({ getPublicArticle: publicArticle }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import sitemap from '@/app/sitemap'
import { generateMetadata } from '@/app/articles/[slug]/page'
import { buildFeedXml } from '@/lib/publicFeeds'
import { articleShareUrl } from '@/lib/shareUrl'
import { SITE_URL } from '@/lib/constants'

const NEW = 'will-si-stocks-make-you-rich-in-2026'
const OLD = 'draft-1791210392433'

afterEach(() => vi.unstubAllEnvs())

describe('sitemap', () => {
  it('lists newly published articles at their current address and never a retired one', async () => {
    sitemapData.mockResolvedValue({
      articles: [
        { slug: NEW, updatedAt: '2026-10-24T12:19:16.359Z' },
        { slug: 'tulip-mania-lessons-from-the-17th-century', updatedAt: '2026-10-23T08:00:10.177Z' },
        { slug: 'a-just-published-article', updatedAt: '2026-10-25T09:00:00.000Z' },
      ],
      categories: [], tags: [], authors: [],
    })
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls).toContain(`${SITE_URL}/articles/${NEW}`)
    expect(urls).toContain(`${SITE_URL}/articles/a-just-published-article`)
    expect(urls.some((url) => url.includes('/articles/draft-'))).toBe(false)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('is one sitemap at /sitemap.xml, registered from robots.txt (no second sitemap file)', async () => {
    const { readdirSync } = await import('node:fs')
    const appFiles = readdirSync('src/app')
    expect(appFiles.filter((f) => /sitemap/i.test(f))).toEqual(['sitemap.ts'])
    const robots = (await import('@/app/robots')).default()
    expect(robots.sitemap).toBe(`${SITE_URL}/sitemap.xml`)
  })
})

describe('article metadata', () => {
  const article = {
    id: 'cmuvcf4eb000204jp254gpqci', slug: NEW, title: 'Will SI stocks make you rich in 2026?', excerpt: 'Standfirst',
    coverImage: null, publishedAt: new Date('2026-10-23T08:00:08.610Z'), updatedAt: new Date('2026-10-24T12:19:16.359Z'),
    author: { name: 'Writer' },
  }

  it('canonical and og:url name the current address, even when the page was reached by an old one', async () => {
    publicArticle.mockResolvedValue(article)
    for (const requested of [NEW, OLD]) {
      const meta = await generateMetadata({ params: Promise.resolve({ slug: requested }) })
      expect(meta.alternates?.canonical).toBe(`/articles/${NEW}`)
      expect((meta.openGraph as { url?: string }).url).toBe(`${SITE_URL.replace(/\/$/, '')}/articles/${NEW}`)
    }
  })
})

describe('feeds and sharing', () => {
  it('RSS links and guids use the current address', () => {
    const xml = buildFeedXml([{ title: 't', slug: NEW, excerpt: null, publishedAt: '2026-10-23T08:00:08.610Z', authorName: null, category: null }], { siteUrl: SITE_URL, description: 'd' })
    expect(xml).toContain(`<link>${SITE_URL}/articles/${NEW}</link>`)
    expect(xml).not.toContain(OLD)
  })

  it('share links and the canonical origin agree on the host, with and without NEXT_PUBLIC_SITE_URL', async () => {
    // Without the variables (whatever the test runner sets), both fall back to the same production host.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined)
    vi.stubEnv('VERCEL_URL', undefined)
    vi.resetModules()
    const fresh = { constants: await import('@/lib/constants'), share: await import('@/lib/shareUrl') }
    expect(fresh.constants.SITE_URL).toBe('https://theconsilium.co.uk')
    expect(new URL(fresh.share.articleShareUrl(NEW)).host).toBe(new URL(fresh.constants.SITE_URL).host)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://theconsilium.co.uk')
    expect(articleShareUrl(NEW)).toBe(`https://theconsilium.co.uk/articles/${NEW}`)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.theconsilium.co.uk')
    expect(articleShareUrl(NEW)).toBe(`https://www.theconsilium.co.uk/articles/${NEW}`)
  })
})
