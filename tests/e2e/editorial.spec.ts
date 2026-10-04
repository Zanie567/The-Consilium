import { test, expect } from '@playwright/test'
import { collectConsoleErrors } from './helpers/console'

/**
 * Every editorial sub-route must load (authenticated), render its main heading,
 * and produce no console errors. Runs with the admin session saved by auth.setup.
 */
const ROUTES = [
  '/editorial',
  '/editorial/articles',
  '/editorial/articles/new',
  '/editorial/series',
  '/editorial/scheduled',
  '/editorial/trash',
  '/editorial/review',
  '/editorial/debates',
  '/editorial/comments',
  '/editorial/users',
  '/editorial/analytics',
]

for (const route of ROUTES) {
  test(`${route} loads, shows a heading, no console errors`, async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto(route, { waitUntil: 'networkidle' })

    // Authenticated — not bounced to the login page.
    expect(page.url(), `was redirected to login from ${route}`).not.toContain('/login')

    // Main heading / content region present. The article editor is a full-screen
    // editing surface whose "heading" is the headline input, not an <h1>.
    if (route === '/editorial/articles/new') {
      await expect(page.getByPlaceholder(/headline|Untitled document/i).first()).toBeVisible()
    } else {
      await expect(page.locator('h1').first()).toBeVisible()
    }

    expect(errors, `console errors on ${route}:\n${errors.join('\n')}`).toEqual([])
  })
}

test('debates and comments pages have page-specific titles (Priority 5)', async ({ page }) => {
  await page.goto('/editorial/debates', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveTitle(/Debates \| Editorial/)

  await page.goto('/editorial/comments', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveTitle(/Comment Moderation \| Editorial/)
})

// ── Audit additions ──────────────────────────────────────────────────────────

test('Analytics: every tab loads with no console errors, and Writers shows data', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/editorial/analytics', { waitUntil: 'networkidle' })

  // Writers is opened separately below, where its data request is awaited.
  for (const label of ['Overview', 'Content', 'Audience', 'Engagement', 'Distribution']) {
    const tab = page.getByRole('button', { name: label, exact: true })
    if (await tab.count()) {
      await tab.first().click()
      await page.waitForTimeout(600) // lazy fetch + render
    }
  }

  // Writers tab (the "No writers…" bug): open it, wait for its data, and assert
  // it renders writer rows rather than the empty state.
  const writersTab = page.getByRole('button', { name: 'Writers', exact: true })
  const analyticsResp = page.waitForResponse(
    (r) => r.url().includes('tab=leaderboard') && r.ok(),
    { timeout: 10_000 },
  )
  await writersTab.first().click()
  await analyticsResp
  await expect(page.getByText('No writers have published articles')).toHaveCount(0)
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 })

  expect(errors, `analytics console errors:\n${errors.join('\n')}`).toEqual([])
})

test('Comment Moderation loads WITHOUT the error banner and shows real stats', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/editorial/comments', { waitUntil: 'networkidle' })

  // The 503-era failure rendered a red error banner — it must be gone.
  await expect(page.getByText(/could not be loaded/i)).toHaveCount(0)

  // Stats tiles show real numbers, not the "—" placeholder.
  const total = await page
    .locator('text=Total Comments')
    .locator('xpath=following-sibling::*[1]')
    .textContent()
  expect(total?.trim()).toMatch(/^\d[\d,]*$/)

  // All three tabs switch without error.
  for (const tab of ['Reported', 'Recent', 'Hidden']) {
    await page.getByRole('button', { name: new RegExp(tab, 'i') }).first().click()
    await page.waitForTimeout(400)
  }
  expect(errors, `moderation console errors:\n${errors.join('\n')}`).toEqual([])
})

test('New Article editor autosaves a draft', async ({ page }) => {
  await page.goto('/editorial/articles/new', { waitUntil: 'networkidle' })
  const headline = page.getByPlaceholder(/Untitled document|headline/i).first()
  await expect(headline).toBeVisible()

  // Typing should trigger autosave (POST /api/articles) and a "Saved" state.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/articles') && ['POST', 'PATCH', 'PUT'].includes(r.request().method()),
    { timeout: 15_000 },
  )
  const title = `E2E autosave draft ${Date.now()}`
  await headline.fill(title)
  const res = await saved
  // A successful save must be a 201 (create) / 200 (update); "not a 5xx" also passed 4xx.
  expect(res.status(), await res.text()).toBe(201)
  const { id } = (await res.json()) as { id: string }
  await expect(page.getByText(/^Saved$/).first()).toBeVisible({ timeout: 15_000 })

  // Reopen it: the draft must really be stored, not just acknowledged.
  await page.goto(`/editorial/articles/${id}/edit`, { waitUntil: 'networkidle' })
  await expect(page.getByPlaceholder(/Your headline here/)).toHaveValue(title)
})

test('bookmarks are fetched ONCE per page, not once per card (Bug 7)', async ({ page }) => {
  // Signed in (admin storage) → every ArticleCard renders a BookmarkButton.
  const bookmarkCalls: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes('/api/bookmarks')) bookmarkCalls.push(r.url())
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  // Wait a beat for any late client fetches.
  await page.waitForTimeout(800)
  const cards = await page.locator('a[href^="/articles/"]').count()
  expect(cards, 'homepage should render multiple article cards').toBeGreaterThan(3)
  expect(
    bookmarkCalls.length,
    `GET /api/bookmarks fired ${bookmarkCalls.length}× for ${cards} cards (should be ≤ 1)`,
  ).toBeLessThanOrEqual(1)
})

test('visible moderation total equals the comment counts across every users-table page', async ({ page }) => {
  test.setTimeout(60_000) // Two screens and every seeded user page; exact responses synchronize the rendered counts.
  const moderation = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/comments' && r.request().method() === 'GET')
  await page.goto('/editorial/comments', { waitUntil: 'networkidle' })
  const moderationResponse = await moderation
  expect(moderationResponse.status()).toBe(200)
  const stats = (await moderationResponse.json()).stats
  const statValue = (label: string) => page.getByText(label, { exact: true }).locator('..').locator('p').nth(1)
  await expect(statValue('Total Comments')).toHaveText(String(stats.total))
  await expect(statValue('Hidden')).toHaveText(String(stats.hidden))
  const visibleTotal = Number(await statValue('Total Comments').innerText()) - Number(await statValue('Hidden').innerText())
  expect(visibleTotal).toBeGreaterThan(0)
  const first = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/users' && r.request().method() === 'GET')
  await page.goto('/editorial/users', { waitUntil: 'networkidle' })
  let response = await first
  let sum = 0
  for (;;) {
    expect(response.status()).toBe(200)
    const data = await response.json()
    const counts = page.locator('tbody tr td:nth-child(4)')
    await expect(counts).toHaveText(data.users.map((user: { _count: { comments: number } }) => String(user._count.comments)))
    sum += (await counts.allInnerTexts()).reduce((total, count) => total + Number(count), 0)
    const next = page.getByLabel('Next users page', { exact: true })
    if (await next.isDisabled()) break
    const changed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/users' && r.request().method() === 'GET')
    await next.click()
    response = await changed
  }
  expect(sum).toBe(visibleTotal)
})
