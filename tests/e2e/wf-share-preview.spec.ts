/**
 * Social-sharing previews, as a crawler sees them: the og:/twitter: tags in the served HTML of
 * every kind of public page, and the image each one names, fetched and decoded. Until October 2026
 * every link shared from the site previewed the obsolete cream seal at /logo.png.
 *
 * Plain HTTP (no page is rendered in a browser), so it runs on Chromium only.
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import sharp from 'sharp'
import { closeDb, db, removeMyArticles, uniqueTitle } from './helpers/workflow'
import { legacyMatch } from '../helpers/legacyBrand'
import { BRAND_MARK, LEGACY_LOGO_PATH, SHARE_IMAGE } from '../../src/lib/brand'

test.skip(({ browserName }) => browserName !== 'chromium', 'HTTP-only checks; one engine is enough')
test.afterAll(async () => { await removeMyArticles(); await closeDb() })

const TRADING_IMAGE = '/og/trading-challenge.png'
// An allowed cover host (next.config.ts remotePatterns). The HTML names it; nothing fetches it here.
const COVER = 'https://images.unsplash.com/photo-share-preview-cover?w=1600'

/** Every `content` of <meta property|name="key">, in document order. */
function metaAll(html: string, key: string): string[] {
  const values: string[] = []
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
    const name = /\b(?:property|name)="([^"]+)"/.exec(tag)?.[1]
    const content = /\bcontent="([^"]*)"/.exec(tag)?.[1]
    if (name === key && content !== undefined) values.push(content.replaceAll('&amp;', '&'))
  }
  return values
}
const meta = (html: string, key: string) => metaAll(html, key)[0]

async function previewOf(request: APIRequestContext, path: string) {
  const res = await request.get(path)
  expect(res.status(), path).toBe(200)
  const html = await res.text()
  return {
    ogImages: metaAll(html, 'og:image'),
    og: { width: meta(html, 'og:image:width'), height: meta(html, 'og:image:height'), type: meta(html, 'og:image:type'), alt: meta(html, 'og:image:alt') },
    twitterCard: meta(html, 'twitter:card'),
    twitterImages: metaAll(html, 'twitter:image'),
    twitterAlt: meta(html, 'twitter:image:alt'),
  }
}

/** Absolute (a crawler has no base URL to resolve against) and pointing at `expectedPath`. */
function expectImageUrl(url: string | undefined, expectedPath: string, where: string) {
  expect(url, `${where}: image missing`).toBeTruthy()
  expect(url!, `${where}: image URL must be absolute`).toMatch(/^https?:\/\//)
  const parsed = new URL(url!)
  expect(`${parsed.pathname}${parsed.search}`, where).toBe(expectedPath)
}

async function expectDefaultCard(request: APIRequestContext, path: string) {
  const p = await previewOf(request, path)
  expect(p.ogImages, `${path}: exactly one og:image`).toHaveLength(1)
  expectImageUrl(p.ogImages[0], SHARE_IMAGE.url, `${path} og:image`)
  expect(p.og).toEqual({ width: String(SHARE_IMAGE.width), height: String(SHARE_IMAGE.height), type: SHARE_IMAGE.type, alt: SHARE_IMAGE.alt })
  expect(p.twitterCard, path).toBe('summary_large_image')
  expectImageUrl(p.twitterImages[0], SHARE_IMAGE.url, `${path} twitter:image`)
  expect(p.twitterAlt, path).toBe(SHARE_IMAGE.alt)
}

test('static public pages declare the approved share card for Open Graph and X', async ({ request }) => {
  const category = await db().category.findFirstOrThrow({ select: { slug: true } })
  for (const path of ['/', '/about', '/team', '/archive', '/contact', '/corrections', '/opinion-debate', `/category/${category.slug}`]) {
    await expectDefaultCard(request, path)
  }
})

test('the trading challenge keeps its own campaign card on both platforms', async ({ request }) => {
  const p = await previewOf(request, '/trading-challenge')
  expectImageUrl(p.ogImages[0], TRADING_IMAGE, 'trading og:image')
  expect([p.og.width, p.og.height]).toEqual(['1200', '630'])
  expect(p.twitterCard).toBe('summary_large_image')
  expectImageUrl(p.twitterImages[0], TRADING_IMAGE, 'trading twitter:image')
})

test('articles share their cover image, or the approved card when they have none; author pages use the card', async ({ request }) => {
  const writer = await db().user.findFirstOrThrow({ where: { email: 'writer@theconsilium.com' }, select: { id: true, slug: true } })
  const make = async (label: string, coverImage: string | null) => {
    const title = uniqueTitle(label)
    return db().article.create({
      data: {
        title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), coverImage,
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Share preview fixture.' }] }] }),
        excerpt: 'A synthetic article for the share-preview test.',
        authorId: writer.id, status: 'PUBLISHED', publishedAt: new Date(),
      },
    })
  }
  const plain = await make('share no cover', null)
  const covered = await make('share cover', COVER)

  await expectDefaultCard(request, `/articles/${plain.slug}`)

  const p = await previewOf(request, `/articles/${covered.slug}`)
  expect(p.ogImages).toHaveLength(1)
  expectImageUrl(p.ogImages[0], new URL(COVER).pathname + new URL(COVER).search, 'cover og:image')
  expect(p.og.alt).toBe(covered.title)
  expect(p.twitterCard).toBe('summary_large_image')
  expectImageUrl(p.twitterImages[0], new URL(COVER).pathname + new URL(COVER).search, 'cover twitter:image')
  expect(p.ogImages.join(' ') + p.twitterImages.join(' ')).not.toContain(SHARE_IMAGE.url)

  await expectDefaultCard(request, `/author/${writer.slug ?? writer.id}`)
})

test('brand images are served as PNGs of the declared size, and none is the obsolete design', async ({ request }) => {
  for (const [path, width, height] of [
    [SHARE_IMAGE.url, SHARE_IMAGE.width, SHARE_IMAGE.height],
    [BRAND_MARK.url, BRAND_MARK.width, BRAND_MARK.height],
    [TRADING_IMAGE, 1200, 630],
    // Old links and external caches still request this; it must now be the current mark.
    [LEGACY_LOGO_PATH, BRAND_MARK.width, BRAND_MARK.height],
    ['/apple-touch-icon.png', 180, 180],
    ['/favicon-navy-32.png', 32, 32],
    ['/favicon-cream-32.png', 32, 32],
  ] as const) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
    expect(res.headers()['content-type'], path).toBe('image/png')
    const body = await res.body()
    const { width: w, height: h } = await sharp(body).metadata()
    expect([w, h], path).toEqual([width, height])
    expect(await legacyMatch(body), path).toBeNull()
  }
  // The app-directory apple icon (served at /apple-icon.png) is the emblem, not the cream dome
  // illustration that used to sit, shadowed, at public/apple-icon.png.
  const apple = await request.get('/apple-icon.png')
  expect(apple.status()).toBe(200)
  expect(await legacyMatch(await apple.body())).toBeNull()
})
