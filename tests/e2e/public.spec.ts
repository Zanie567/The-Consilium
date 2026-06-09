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

// ── Audit additions ──────────────────────────────────────────────────────────

test('category pages have NO duplicate article titles and count matches unique articles', async ({ page }) => {
  const expected = await expectedCategoryArticles()
  for (const cat of expected.filter((c) => c.publishedCount > 0)) {
    await page.goto(`/category/${cat.slug}`, { waitUntil: 'networkidle' })

    // Unique article links === total article links → no card is rendered twice.
    const hrefs = await countArticleLinks(page)
    expect(new Set(hrefs).size, `duplicate article links on /category/${cat.slug}`).toBe(hrefs.length)
    expect(hrefs.length, `/category/${cat.slug} count`).toBe(cat.publishedCount)

    // Card titles must also be unique (catches same title under different slugs).
    const titles = (await page.locator('main article h3').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
    expect(new Set(titles).size, `duplicate titles on /category/${cat.slug}: ${titles.join(' | ')}`).toBe(titles.length)

    // The "N articles" header must equal the unique count.
    const header = await page.locator('section p').filter({ hasText: /\barticles?\b/ }).first().textContent()
    expect(header?.replace(/\D/g, '')).toBe(String(cat.publishedCount))
  }
})

test('article page: correct title/meta, share, copy-link, save controls; reading progress advances on scroll', async ({ page }) => {
  const article = (await allPublishedArticles())[0]
  await page.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })

  // Bug 4 guard: the page's title AND Open-Graph meta must reflect THIS article
  // (not a stale snapshot of a previously-viewed one).
  await expect(page.locator('h1').first()).toContainText(article.title.slice(0, 24))
  await expect(page).toHaveTitle(new RegExp(article.title.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
  expect(ogTitle, 'og:title must match the article').toBe(article.title)

  await expect(page.getByLabel('Share on X / Twitter')).toBeVisible()
  await expect(page.getByLabel('Copy link')).toBeVisible()
  // Signed-out "Save" affordance (links to /login) still renders.
  await expect(page.getByText('Save', { exact: true }).first()).toBeVisible()

  const barScaleX = () =>
    page.locator('div.origin-left.bg-gold').first().evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      return m.a // scaleX
    })
  const before = await barScaleX()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(700) // let the spring settle
  const after = await barScaleX()
  expect(after, `reading progress did not advance (before=${before}, after=${after})`).toBeGreaterThan(before)
})

test('debate hub: the vote flow is wired up (button → API → results)', async ({ page }) => {
  await page.goto('/opinion-debate', { waitUntil: 'networkidle' })
  await expect(page.getByLabel('Opinion debate').first()).toBeVisible()

  const forBtn = page.getByLabel('Vote for the For side of this debate').first()
  const hasButtons = (await forBtn.count()) > 0 && (await forBtn.isVisible().catch(() => false))

  if (hasButtons) {
    // Capture the actual vote API call so the test is deterministic regardless
    // of whether this client/IP has voted before (200 = recorded, 409 = already
    // voted). Either way the flow works and never 5xx's.
    const votePromise = page.waitForResponse(
      (r) => /\/api\/debates\/.+\/vote/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 8_000 },
    )
    await forBtn.click()
    const voteRes = await votePromise
    expect(voteRes.status(), 'vote endpoint must not 5xx').toBeLessThan(500)
    expect([200, 409, 429]).toContain(voteRes.status())
    if (voteRes.status() === 200) {
      // A fresh vote flips the panel into its results view.
      await expect(forBtn).toBeHidden({ timeout: 8_000 })
    }
  } else {
    // Already in a results state (closed or previously voted) — totals show.
    await expect(page.getByText(/\bvotes?\b/i).first()).toBeVisible()
  }
})

test('search highlights matched terms with <mark>', async ({ page }) => {
  await page.goto('/search?q=trade', { waitUntil: 'networkidle' })
  const marks = page.locator('mark')
  await expect(marks.first()).toBeVisible({ timeout: 10_000 })
  expect(await marks.count()).toBeGreaterThan(0)
})

test('navigating across pages throws no InvalidStateError (view-transition guard)', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page)
  const invalidState: string[] = []
  const watch = (text: string) => {
    if (/InvalidStateError|Transition was aborted because of invalid state/i.test(text)) invalidState.push(text)
  }
  page.on('console', (m) => watch(m.text()))
  page.on('pageerror', (e) => watch(`${e.name}: ${e.message}`))

  // Full document loads (exercise the removed @view-transition navigation rule)…
  for (const path of ['/', '/category/opinion', '/opinion-debate', '/category/news', '/about', '/']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(150)
  }
  // …then rapid client-side navigations (exercise Next's SPA transitions). Use
  // 'domcontentloaded', not 'networkidle' — the dev server's HMR socket keeps
  // the network busy, so 'networkidle' never settles.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const links = page.locator('header a[href^="/category/"], main a[href^="/articles/"]')
  const n = Math.min(await links.count(), 5)
  for (let i = 0; i < n; i++) {
    await links.nth(i).click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(200)
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
  }
  await page.waitForTimeout(300)

  expect(invalidState, `InvalidStateError fired:\n${invalidState.join('\n')}`).toEqual([])
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([])
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
