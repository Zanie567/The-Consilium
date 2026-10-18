import { test, expect } from '@playwright/test'
import { db, closeDb } from './helpers/workflow'

test.afterAll(closeDb)

test('public launch routes, article SEO, feed distribution and images work at the configured device size', async ({ page, request }, testInfo) => {
  test.setTimeout(90000)
  const article = await db().article.findFirstOrThrow({
    where: { status: 'PUBLISHED', deletedAt: null, isDebate: false, categoryId: { not: null }, publishedAt: { not: null } },
    include: { category: true },
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const paths = ['/', '/team', '/about', '/archive', '/search', '/login', '/editorial/login',
    `/category/${article.category!.slug}`, `/articles/${article.slug}`]
  for (const path of paths) {
    const response = await page.goto(path, { waitUntil: 'networkidle' })
    expect(response?.status(), path).toBe(200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true)
  }
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${process.env.E2E_BASE_URL}/articles/${article.slug}`)
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', article.title)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /.+/)
  const schemas = await page.locator('script[type="application/ld+json"]').allTextContents()
  const schema = schemas.map(text => JSON.parse(text)).find(item => item.headline === article.title)
  expect(schema).toMatchObject({ headline: article.title, dateModified: article.updatedAt.toISOString() })
  await page.locator('img').evaluateAll(async nodes => {
    await Promise.all(nodes.map(async node => {
      const img = node as HTMLImageElement
      img.loading = 'eager'
      try { await img.decode() } catch { /* Assertion below records the failure. */ }
    }))
  })
  expect(await page.locator('img').evaluateAll(nodes => nodes.filter(node => !(node as HTMLImageElement).naturalWidth).length)).toBe(0)
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expect(await sitemap.text()).toContain(`/articles/${article.slug}`)
  const feed = await request.get('/feed.xml')
  expect(feed.status()).toBe(200)
  expect(await feed.text()).toContain('<rss')
  expect((await request.get('/articles/launch-deliberately-missing')).status()).toBe(404)
  // Only synthetic local fixtures appear in the retained screenshot.
  await page.screenshot({ path: testInfo.outputPath('launch-article.png'), fullPage: true })
  expect(errors).toEqual([])
})
