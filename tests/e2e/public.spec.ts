import { test, expect } from '@playwright/test'
import { collectConsoleErrors } from './helpers/console'
import {
  expectedCategoryArticles,
  allPublishedArticles,
  findPublishedByTitleContains,
  closeDb,
} from './helpers/db'

test.afterAll(async () => {
  await closeDb()
})

function countArticleLinks(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const hrefs = new Set<string>()
    document.querySelectorAll('a[href^="/articles/"]').forEach((a) => {
      hrefs.add((a as HTMLAnchorElement).getAttribute('href') as string)
    })
    return [...hrefs]
  })
}

test('homepage loads with zero console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.locator('h1', { hasText: 'The Consilium' })).toBeVisible()
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('each category page renders exactly the published count from the data layer', async ({ page }) => {
  const expected = await expectedCategoryArticles()
  // Only assert categories that actually have published articles; empty ones
  // legitimately show the "coming soon" state.
  const nonEmpty = expected.filter((c) => c.publishedCount > 0)
  expect(nonEmpty.length).toBeGreaterThan(0)

  for (const cat of nonEmpty) {
    await page.goto(`/category/${cat.slug}`, { waitUntil: 'networkidle' })
    const links = await countArticleLinks(page)
    expect(
      links.length,
      `/category/${cat.slug} should show ${cat.publishedCount} articles but showed ${links.length}`,
    ).toBe(cat.publishedCount)
  }
})

test('Priority 1 guard: EVERY published article is reachable on its category page', async ({ page }) => {
  const articles = await allPublishedArticles()
  const withCategory = articles.filter((a) => a.category)
  expect(withCategory.length).toBeGreaterThan(0)

  // Group by category, load each category page once, assert every slug appears.
  const byCategory = new Map<string, string[]>()
  for (const a of withCategory) {
    const slug = a.category!.slug
    byCategory.set(slug, [...(byCategory.get(slug) ?? []), a.slug])
  }

  for (const [categorySlug, slugs] of byCategory) {
    await page.goto(`/category/${categorySlug}`, { waitUntil: 'networkidle' })
    const rendered = new Set(await countArticleLinks(page))
    for (const slug of slugs) {
      expect(
        rendered.has(`/articles/${slug}`),
        `published article /articles/${slug} missing from /category/${categorySlug}`,
      ).toBe(true)
    }
  }
})

test('an article page renders title, body, hero image and share bar', async ({ page }) => {
  const article = (await allPublishedArticles())[0]
  expect(article).toBeTruthy()
  await page.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })

  await expect(page.locator('h1').first()).toContainText(article.title.slice(0, 20))
  await expect(page.locator('.prose-consilium').first()).toBeVisible()
  await expect(page.locator('img').first()).toBeVisible() // hero image
  await expect(page.getByLabel('Share on X / Twitter')).toBeVisible() // share bar
})

test('search "carbon" returns the carbon article', async ({ page }) => {
  const expected = await findPublishedByTitleContains('carbon')
  expect(expected, 'seed should contain a "carbon" article').toBeTruthy()

  await page.goto('/search?q=carbon', { waitUntil: 'networkidle' })
  const result = page.locator(`a[href="/articles/${expected!.slug}"]`)
  await expect(result.first()).toBeVisible({ timeout: 10_000 })
})

test('dark-mode toggle switches theme', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const html = page.locator('html')
  const startedDark = (await html.getAttribute('class'))?.includes('dark') ?? false

  // The toggle exposes one of these two labels depending on current theme.
  const toggle = page.getByLabel(startedDark ? 'Switch to light mode' : 'Switch to dark mode')
  await toggle.first().click()
  await page.waitForTimeout(400)

  const nowDark = (await html.getAttribute('class'))?.includes('dark') ?? false
  expect(nowDark).toBe(!startedDark)
})

test('contact form shows validation on empty submit', async ({ page }) => {
  await page.goto('/contact', { waitUntil: 'networkidle' })
  await page.locator('button[type="submit"]').click()

  // Native required-field validation blocks submission: the first field is invalid
  // and no success state appears.
  const nameValid = await page.locator('input[name="name"]').evaluate(
    (el) => (el as HTMLInputElement).validity.valid,
  )
  expect(nameValid).toBe(false)
  await expect(page.getByText(/message sent|thank you/i)).toHaveCount(0)
})

test.describe('hero headings have visible contrast (Priority 3 regression guard)', () => {
  for (const path of ['/about', '/opinion-debate', '/category/opinion', '/contact']) {
    test(`hero h1 on ${path} is not the background colour`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      const info = await page.evaluate(() => {
        const h1 = document.querySelector('section h1') as HTMLElement | null
        if (!h1) return null
        const section = h1.closest('section') as HTMLElement
        const parse = (c: string) => (c.match(/\d+/g) ?? []).map(Number)
        return { color: parse(getComputedStyle(h1).color), bg: parse(getComputedStyle(section).backgroundColor) }
      })
      expect(info, `no hero <h1> found on ${path}`).not.toBeNull()
      const { color, bg } = info!
      // Channel-distance well above the near-zero-contrast bug threshold.
      const dist =
        Math.abs(color[0] - bg[0]) + Math.abs(color[1] - bg[1]) + Math.abs(color[2] - bg[2])
      expect(dist, `hero text ${color} vs bg ${bg} on ${path} has too little contrast`).toBeGreaterThan(150)
    })
  }
})
