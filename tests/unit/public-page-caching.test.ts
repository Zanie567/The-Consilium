/**
 * Contract for the public pages served from the CDN (ISR), introduced to cut Vercel Active CPU
 * (docs/operations/vercel-cpu-optimisation-2026-11.md). A cached page is identical for every visitor,
 * so these guards keep anything per-visitor out of it, keep the cache lifetimes consistent, and pin
 * the invalidation and routing the pages depend on.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import nextConfig from '../../next.config'
import { matchHas } from 'next/dist/shared/lib/router/utils/prepare-destination'
import { PUBLIC_PAGE_REVALIDATE_SECONDS } from '@/lib/articleQueries'
import { PUBLICATION_LINKEDIN_REVALIDATE_SECONDS } from '@/lib/growthSettings'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
// Comments explain the rules in plain words ("must not read the session"); check code only.
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CACHED_ROUTES = [
  'src/app/(home)/home-section/[category]/page.tsx',
  'src/app/articles/[slug]/page.tsx',
  'src/app/category/[slug]/page.tsx',
  'src/app/tag/[slug]/page.tsx',
]
// Everything rendered into the cached pages that is not a client component.
const CACHED_SERVER_CODE = [...CACHED_ROUTES, 'src/components/home/HomeView.tsx', 'src/lib/publicPageData.ts']

describe('CDN-cached public pages', () => {
  it.each(CACHED_ROUTES)('%s is ISR with the shared lifetime, rendered on demand (never at build time)', (path) => {
    const src = code(path)
    expect(src).toMatch(new RegExp(`export const revalidate = ${PUBLIC_PAGE_REVALIDATE_SECONDS}\\b`))
    expect(src).toMatch(/export function generateStaticParams\(\) \{\s*return \[\]\s*\}/)
    expect(src).not.toMatch(/export const dynamic\b/)
  })

  it.each(CACHED_SERVER_CODE)('%s never reads the session, cookies, headers or searchParams', (path) => {
    const src = code(path)
    for (const forbidden of [/next\/headers/, /getServerSession/, /\bcookies\(/, /\bheaders\(/, /searchParams/, /@\/lib\/auth'/, /connection\(/]) {
      expect(src, `${path} uses ${forbidden}`).not.toMatch(forbidden)
    }
  })

  it('the old per-request homepage route is gone (it would be prerendered at build time)', () => {
    expect(() => read('src/app/(home)/page.tsx')).toThrow()
  })

  it('data caches inside the cached pages live at least as long as the page', () => {
    expect(PUBLIC_PAGE_REVALIDATE_SECONDS).toBeGreaterThanOrEqual(3600)
    // The footer is in every page; a shorter cache there would shorten every page's lifetime.
    expect(PUBLICATION_LINKEDIN_REVALIDATE_SECONDS).toBeGreaterThanOrEqual(PUBLIC_PAGE_REVALIDATE_SECONDS)
    expect(code('src/lib/glossary/data.ts')).toMatch(/tags: \[GLOSSARY_CACHE_TAG\], revalidate: 3600 \}/)
    expect(code('src/app/category/[slug]/page.tsx')).toMatch(/revalidate: PUBLIC_PAGE_REVALIDATE_SECONDS, tags: \[ARTICLES_CACHE_TAG\]/)
    expect(code('src/components/home/HomeView.tsx')).toMatch(/PUBLIC_LIST_CACHE = \{ revalidate: PUBLIC_PAGE_REVALIDATE_SECONDS, tags: \[ARTICLES_CACHE_TAG\] \}/)
  })

  it('cached pages never swallow a database failure into cacheable output', () => {
    // A tag outage used to read as "no such tag" and 404. Cached, that would last an hour.
    expect(code('src/app/tag/[slug]/page.tsx')).not.toMatch(/\.catch\(/)
    expect(code('src/components/home/HomeView.tsx')).not.toMatch(/\.catch\(\(\) => (\[\]|null)\)/)
    expect(code('src/components/home/HomeView.tsx')).not.toMatch(/catch \{\s*return null/)
  })

  it('reader-specific controls get the viewer from the client session, not from the page', () => {
    expect(code('src/components/ui/CommentSection.tsx')).toMatch(/useSession\(\)/)
    expect(code('src/app/articles/[slug]/page.tsx')).toMatch(/<CommentSection articleId=\{article\.id\} \/>/)
    expect(code('src/components/home/HomeView.tsx')).toMatch(/<DebatePanel initialData=\{activeDebate\} personalise \/>/)
    // The anonymous debate view never carries a vote.
    expect(code('src/components/home/HomeView.tsx')).toMatch(/userSide: null/)
  })

  it('every article-visibility change expires the CDN copies, not only the tagged lists', () => {
    const src = code('src/lib/revalidateArticles.ts')
    expect(src).toMatch(/revalidateTag\(ARTICLES_CACHE_TAG, \{ expire: 0 \}\)/)
    expect(src).toMatch(/revalidatePath\('\/', 'layout'\)/)
    // Per-article settings shown on the cached page refresh it themselves.
    expect(code('src/app/api/editorial/articles/[id]/cover-metadata/route.ts')).toMatch(/revalidatePath\(`\/articles\/\$\{auth\.article\.slug\}`\)/)
    expect(code('src/app/api/editorial/articles/[id]/cover-framing/route.ts')).toMatch(/revalidatePath\(`\/articles\/\$\{access\.article\.slug\}`\)/)
    // Bylines (name, photo) on cached pages.
    for (const path of ['src/app/api/profile/account/route.ts', 'src/app/api/team-profile/route.ts']) {
      expect(code(path), path).toMatch(/await revalidateArticleLists\(\)/)
    }
  })
})

describe('homepage routing (next.config.ts rewrites)', () => {
  // Next's unstable_getResponseFromNextConfig drops parameters captured by `has` (Next 16.4.2), so
  // this applies the rewrites the way the real router does (server/lib/router-utils/resolve-routes.js:
  // matchHas, then its params are merged into the destination). The browser suite covers the live
  // tab navigation.
  async function rewrittenTo(url: string): Promise<string | null> {
    const parsed = new URL(url, 'https://theconsilium.co.uk')
    const query = Object.fromEntries(parsed.searchParams)
    const config = await nextConfig.rewrites!()
    const rules = Array.isArray(config) ? config : config.beforeFiles ?? []
    for (const rule of rules) {
      if (rule.source !== parsed.pathname) continue
      const params = matchHas({ headers: {} } as never, query, rule.has, rule.missing)
      if (!params) continue
      return rule.destination.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(String(params[key])))
    }
    return null
  }

  it.each([
    ['/', '/home-section/_'],
    ['/?category=', '/home-section/_'],
    ['/?category=news', '/home-section/news'],
    ['/?category=opinion&utm_source=x', '/home-section/opinion'],
  ])('%s is rendered by %s', async (url, target) => {
    expect(await rewrittenTo(url)).toBe(target)
  })

  it('leaves every other address alone', async () => {
    for (const url of ['/articles/x', '/category/news', '/archive?category=news', '/about']) {
      expect(await rewrittenTo(url), url).toBeNull()
    }
    // Next's own matcher agrees for paths it can evaluate (no captured parameter involved).
    for (const url of ['/articles/x', '/about']) {
      const res = await unstable_getResponseFromNextConfig({ url: `https://theconsilium.co.uk${url}`, nextConfig })
      expect(res.headers.get('x-middleware-rewrite'), url).toBeNull()
    }
  })

  it('the "All" view segment can never be a category slug', () => {
    expect(code('src/components/home/HomeView.tsx')).toMatch(/export const ALL_VIEW_SEGMENT = '_'/)
    expect(code('src/app/(home)/home-section/[category]/page.tsx')).toMatch(/category === ALL_VIEW_SEGMENT \? undefined/)
  })
})

describe('testing workspace', () => {
  it('testing-mode builds render the cached routes per request through their twins', async () => {
    const previous = process.env.TESTING_MODE_ENABLED
    process.env.TESTING_MODE_ENABLED = '1'
    try {
      const config = await nextConfig.rewrites!()
      const rules = Array.isArray(config) ? config : config.beforeFiles ?? []
      expect(rules.map((r) => [r.source, r.destination])).toEqual([
        ['/', '/testing-dynamic/home-section/:category'],
        ['/', '/testing-dynamic/home-section/_'],
        ['/articles/:slug', '/testing-dynamic/articles/:slug'],
        ['/category/:slug', '/testing-dynamic/category/:slug'],
        ['/tag/:slug', '/testing-dynamic/tag/:slug'],
      ])
    } finally {
      if (previous === undefined) delete process.env.TESTING_MODE_ENABLED
      else process.env.TESTING_MODE_ENABLED = previous
    }
    // Production builds never route there.
    const config = await nextConfig.rewrites!()
    const rules = Array.isArray(config) ? config : config.beforeFiles ?? []
    expect(rules.every((r) => !r.destination.startsWith('/testing-dynamic'))).toBe(true)
  })

  it('the twins are per request, re-export the production page code, and 404 outside testing mode', () => {
    const layout = code('src/app/testing-dynamic/layout.tsx')
    expect(layout).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(layout).toMatch(/if \(process\.env\.TESTING_MODE_ENABLED !== '1'\) notFound\(\)/)
    expect(code('src/app/testing-dynamic/articles/[slug]/page.tsx').trim()).toBe("export { default, generateMetadata } from '@/app/articles/[slug]/page'")
    expect(code('src/app/testing-dynamic/category/[slug]/page.tsx').trim()).toBe("export { default, generateMetadata } from '@/app/category/[slug]/page'")
    expect(code('src/app/testing-dynamic/tag/[slug]/page.tsx').trim()).toBe("export { default, generateMetadata } from '@/app/tag/[slug]/page'")
    expect(code('src/app/testing-dynamic/home-section/[category]/page.tsx').trim()).toBe("export { default, metadata } from '@/app/(home)/home-section/[category]/page'")
  })

  it('the root layout repeats the workspace gate for pages the proxy no longer sees', () => {
    expect(code('src/app/layout.tsx')).toMatch(/if \(testWorkspace\) await \(await import\('@\/lib\/testingMode'\)\)\.requireTestingWorkspace\(\)/)
  })
})
