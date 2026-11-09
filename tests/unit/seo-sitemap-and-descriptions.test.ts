/**
 * Search-facing fixes from the 9 November 2026 SEO audit:
 *   1. The sitemap lists a category or an author only while they have a public article, and an author at the
 *      same address their page declares as canonical (slug, or id while they have none).
 *   2. An article whose excerpt is empty or whitespace still has a description in its meta tag, Open Graph,
 *      Twitter card and structured data (it used to ship none: `'' ?? fallback` is '').
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, sitemapData, publicArticle } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    article: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    siteSetting: { findMany: vi.fn() },
  },
  sitemapData: vi.fn(),
  publicArticle: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/publicFeeds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/publicFeeds')>()),
  getCachedSitemapData: sitemapData,
}))
vi.mock('@/lib/publicPageData', () => ({ getPublicArticle: publicArticle }))
vi.mock('@/lib/corrections/public', () => ({ loadPublicCorrections: vi.fn(async () => []), correctionsStructuredData: () => [] }))
vi.mock('@/lib/glossary/data', () => ({ applyGlossaryLinks: vi.fn(async (_id: string, _at: Date, html: string) => ({ html })) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NOT_FOUND') }), permanentRedirect: vi.fn() }))

import { isValidElement, type ReactElement, type ReactNode } from 'react'
import sitemap from '@/app/sitemap'
import ArticlePage, { generateMetadata as articleMetadata } from '@/app/articles/[slug]/page'
import { generateMetadata as authorMetadata } from '@/app/author/[slug]/page'
import { loadSitemapData } from '@/lib/publicFeeds'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { articleDescription } from '@/lib/seo'
import { SITE_DESCRIPTION, SITE_URL } from '@/lib/constants'

beforeEach(() => vi.clearAllMocks())

// ── 1. Sitemap ───────────────────────────────────────────────────────────────

function fakeDb(over: { categories?: unknown[]; users?: unknown[] } = {}) {
  return {
    article: { findMany: vi.fn().mockResolvedValue([]) },
    category: { findMany: vi.fn().mockResolvedValue(over.categories ?? []) },
    tag: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue(over.users ?? []) },
  }
}

describe('loadSitemapData: who and what is listed', () => {
  it('lists a category only while it has a public article, by the canonical visibility rule', async () => {
    const db = fakeDb()
    await loadSitemapData(db as never)
    const where = db.category.findMany.mock.calls[0][0].where
    // Same rule as the article list (status, trash and the hidden-debate exclusion), so an empty section,
    // or one whose only articles are drafts, trashed or in a hidden debate, is left out.
    expect(where).toEqual({ articles: { some: publishedArticleWhere() } })
    expect(where.articles.some.status).toBe('PUBLISHED')
    expect(where.articles.some.deletedAt).toBeNull()
    expect(where.articles.some.forDebates).toBeDefined()
  })

  it('lists an author only while they have a public article, whatever their role, never a test account', async () => {
    const db = fakeDb()
    await loadSitemapData(db as never)
    const { where, select } = db.user.findMany.mock.calls[0][0]
    expect(where).toEqual({ articles: { some: publishedArticleWhere() }, NOT: { email: { startsWith: 'test-' } } })
    // No longer limited to accounts that have a slug: most published writers have none yet.
    expect(where.slug).toBeUndefined()
    expect(where.role).toBeUndefined()
    expect(select).toEqual({ id: true, slug: true })
  })

  it("uses the author's slug, or their id while they have none (the author page's own canonical)", async () => {
    const db = fakeDb({
      users: [{ id: 'cmslugged000000000000000', slug: 'ada-writer' }, { id: 'cmnoslug0000000000000000', slug: null }],
      categories: [{ slug: 'analysis' }],
    })
    const data = await loadSitemapData(db as never)
    expect(data.authors).toEqual([{ slug: 'ada-writer' }, { slug: 'cmnoslug0000000000000000' }])
    expect(data.categories).toEqual([{ slug: 'analysis' }])
  })
})

describe('sitemap.xml: only intended, public, canonical URLs', () => {
  const data = {
    articles: [{ slug: 'collusion-and-algorithmic-pricing', updatedAt: '2026-11-08T00:50:12.284Z' }],
    categories: [{ slug: 'analysis' }],
    tags: [{ slug: 'pricing' }],
    authors: [{ slug: 'ada-writer' }, { slug: 'cmnoslug0000000000000000' }],
  }

  it('every URL is on the canonical origin, unique, and never private, retired or noindex', async () => {
    sitemapData.mockResolvedValue(data)
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
    for (const url of urls) {
      expect(url.startsWith(SITE_URL)).toBe(true)
      expect(url).not.toMatch(/\/(admin|editorial|api|profile|search|login|signup)(\/|$)|\/articles\/draft-\d+|[?#]/)
    }
    expect(urls).toEqual(expect.arrayContaining([
      `${SITE_URL}/articles/collusion-and-algorithmic-pricing`,
      `${SITE_URL}/category/analysis`,
      `${SITE_URL}/tag/pricing`,
      `${SITE_URL}/author/ada-writer`,
      `${SITE_URL}/author/cmnoslug0000000000000000`,
    ]))
  })

  it('an author URL is exactly the canonical their page declares, with or without a slug', async () => {
    sitemapData.mockResolvedValue(data)
    const authorUrls = (await sitemap()).map((e) => e.url).filter((u) => u.includes('/author/'))
    const users = {
      'ada-writer': { id: 'cmslugged000000000000000', slug: 'ada-writer' },
      cmnoslug0000000000000000: { id: 'cmnoslug0000000000000000', slug: null },
    } as Record<string, { id: string; slug: string | null }>
    db.user.findUnique.mockImplementation(async ({ where }: { where: { slug?: string; id?: string } }) => {
      const user = Object.values(users).find((u) => (where.slug !== undefined ? u.slug === where.slug : u.id === where.id))
      return user ? { ...user, name: 'Writer', email: null, bio: null, image: null, isActive: true, isBanned: false, displayTitles: null, teamProfile: null } : null
    })
    for (const url of authorUrls) {
      const segment = url.slice(`${SITE_URL}/author/`.length)
      const meta = await authorMetadata({ params: Promise.resolve({ slug: segment }), searchParams: Promise.resolve({}) })
      expect(`${SITE_URL}${meta.alternates?.canonical}`).toBe(url)
    }
    expect(authorUrls).toHaveLength(2)
  })

  it('a database failure still serves the static pages only (unchanged fallback)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    sitemapData.mockRejectedValue(new Error('db down'))
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls).toContain(SITE_URL)
    expect(urls.some((u) => /\/(articles|category|tag|author)\//.test(u))).toBe(false)
    log.mockRestore()
  })
})

// ── 2. Article descriptions ──────────────────────────────────────────────────

describe('articleDescription', () => {
  it.each([[null], [undefined], [''], ['   '], ['\n\t ']])('falls back to the site description for %j', (excerpt) => {
    expect(articleDescription(excerpt)).toBe(SITE_DESCRIPTION)
  })
  it('keeps a real excerpt, trimmed of surrounding whitespace only', () => {
    expect(articleDescription('Dynamic pricing is spreading.')).toBe('Dynamic pricing is spreading.')
    expect(articleDescription('  Dynamic pricing is spreading.\n')).toBe('Dynamic pricing is spreading.')
  })
})

const fixture = (excerpt: string | null) => ({
  id: 'cms3hol1f000004l1n2twq7jn', slug: 'tulip-mania-lessons-from-the-17th-century', title: 'Tulip Mania: Lessons from the 17th century',
  excerpt, content: '<p>Body</p>', coverImage: null, categoryId: null, category: null, tags: [], series: null,
  publishedAt: new Date('2026-10-23T08:00:08.610Z'), updatedAt: new Date('2026-10-23T08:00:10.177Z'),
  authorId: 'cmq47ft8e000004jpg2wpyqlp', author: { id: 'cmq47ft8e000004jpg2wpyqlp', name: 'Catherine', slug: null, image: null },
})

/** The Article JSON-LD the page renders (the first <script type="application/ld+json"> in its tree). */
function findJsonLd(node: ReactNode): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findJsonLd(child); if (found) return found }
    return null
  }
  if (!isValidElement(node)) return null
  const props = (node as ReactElement<{ type?: string; children?: ReactNode; dangerouslySetInnerHTML?: { __html: string } }>).props
  if (node.type === 'script' && props.type === 'application/ld+json' && props.dangerouslySetInnerHTML) {
    return JSON.parse(props.dangerouslySetInnerHTML.__html)
  }
  return findJsonLd(props.children)
}

async function descriptionsFor(excerpt: string | null) {
  publicArticle.mockResolvedValue(fixture(excerpt))
  db.article.findMany.mockResolvedValue([])
  const params = Promise.resolve({ slug: 'tulip-mania-lessons-from-the-17th-century' })
  const meta = await articleMetadata({ params })
  const jsonLd = findJsonLd(await ArticlePage({ params }))
  return {
    meta: meta.description,
    openGraph: (meta.openGraph as { description?: string }).description,
    twitter: (meta.twitter as { description?: string }).description,
    structuredData: jsonLd?.description,
  }
}

describe('article page descriptions', () => {
  it.each([[''], ['   '], [null]])('an excerpt of %j still gives every surface the site description', async (excerpt) => {
    expect(await descriptionsFor(excerpt)).toEqual({
      meta: SITE_DESCRIPTION, openGraph: SITE_DESCRIPTION, twitter: SITE_DESCRIPTION, structuredData: SITE_DESCRIPTION,
    })
  })

  it('a real excerpt is used unchanged on every surface', async () => {
    const excerpt = 'Dynamic pricing is spreading across the globe for concerts and sporting events.'
    expect(await descriptionsFor(excerpt)).toEqual({ meta: excerpt, openGraph: excerpt, twitter: excerpt, structuredData: excerpt })
  })
})
