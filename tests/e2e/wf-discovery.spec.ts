import { test, expect } from '@playwright/test'
import { ArticleEditorPage, closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'

test.afterAll(async () => { await removeMyArticles(); await removeMyAccounts(); await closeDb() })

test('public category tabs, every carousel control, archive filters and pagination drive real navigation', async ({ browser }) => {
  test.setTimeout(150_000) // Repeated actual navigation and two archive pages; every navigation retains its 15s deadline.
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  await page.goto('/', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const categories = await db().category.findMany({ orderBy: { name: 'asc' } })
  for (const category of categories) {
    await page.getByRole('tab', { name: category.name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`category=${category.slug}`))
    await expect(page.getByRole('tab', { name: category.name, exact: true })).toHaveAttribute('aria-selected', 'true')
  }
  await page.getByRole('tab', { name: 'All', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'All', exact: true })).toHaveAttribute('aria-selected', 'true')
  const dots = page.getByRole('button', { name: /^Featured article [0-9]+ of/ })
  expect(await dots.count()).toBeGreaterThan(1)
  await dots.nth(0).click()
  await page.getByLabel('Next featured article', { exact: true }).click()
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true')
  await page.getByLabel('Previous featured article', { exact: true }).click()
  await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true')
  for (let i = 0; i < await dots.count(); i++) { await dots.nth(i).click(); await expect(dots.nth(i)).toHaveAttribute('aria-current', 'true') }
  const author = await createAccount('WRITER', 'archive-pages')
  const prefix = uniqueTitle('Archive pages')
  await db().article.createMany({ data: Array.from({ length: 21 }, (_, i) => ({ title: `${prefix} ${i}`, slug: `${prefix}-${i}`.toLowerCase().replaceAll(' ', '-'), content: 'Archive browser fixture', authorId: author.id, categoryId: categories[0].id, status: 'PUBLISHED' as const, publishedAt: new Date(Date.now() - i * 1000) })) })
  await page.goto('/archive', { waitUntil: 'networkidle' })
  const form = page.locator('form').filter({ has: page.getByPlaceholder('Search articles...') })
  await form.getByPlaceholder('Search articles...').fill(prefix)
  await form.locator('select[name=category]').selectOption(categories[0].slug)
  await form.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible()
  await page.getByLabel('Next page', { exact: true }).click()
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  await page.getByLabel('Previous page', { exact: true }).click()
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible()
  await form.getByPlaceholder('Search articles...').fill('No matching archive browser fixture')
  await form.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('link', { name: '← Clear Filters', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '← Clear Filters', exact: true }).click()
  expect(new URL(page.url()).search).toBe('')
  await ctx.close()
})

test('Your Readers author selection, every sort and detail failure/retry display representative data', async ({ browser }) => {
  test.setTimeout(90_000)
  const author = await createAccount('WRITER', 'readers-controls')
  const rows: {id: string; title: string}[] = []
  for (let i = 0; i < 2; i++) {
    const title = uniqueTitle('Reader detail')
    rows.push(await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), content: 'Reader detail fixture', authorId: author.id, status: 'PUBLISHED', publishedAt: new Date(Date.now() - i * 1000) } }))
  }
  const ctx = await signedIn(browser, 'admin')
  const page = await ctx.newPage()
  await page.goto('/editorial/readers', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const listed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/read-through' && new URL(r.url()).searchParams.get('authorId') === author.id)
  await page.getByLabel('Author', { exact: true }).selectOption(author.id)
  expect((await listed).status()).toBe(200)
  await expect(page.locator('tbody tr')).toHaveCount(2)
  for (const label of ['Published', 'Signed-in readers', 'Finished', 'Median furthest point']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(2)
  }
  const detail = `/api/editorial/read-through/${rows[0].id}`
  await page.route(`**${detail}`, r => r.fulfill({ status: 503, json: { error: 'Reader details unavailable' } }))
  await page.locator('tr', { hasText: rows[0].title }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Reader details unavailable' })).toBeVisible()
  await page.unroute(`**${detail}`)
  const response = page.waitForResponse(r => new URL(r.url()).pathname === detail)
  await page.getByRole('button', { name: 'Retry reader data' }).click()
  expect((await response).status()).toBe(200)
  await expect(page.getByText('Not enough data yet', { exact: true })).toBeVisible()
  const readers = []
  for (let i = 0; i < 5; i++) readers.push(await createAccount('READER', 'retention-controls'))
  await db().readingProgress.createMany({ data: readers.map((user, i) => ({ userId: user.id, articleId: rows[0].id, progress: 100 - i * 15, completed: i === 0 })) })
  const enough = page.waitForResponse(r => new URL(r.url()).pathname === detail)
  await page.locator('tr', { hasText: rows[0].title }).click()
  expect((await enough).status()).toBe(200)
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByText('Not enough data yet', { exact: true })).toHaveCount(0)
  await ctx.close()
})

test('writer leaderboard every period, sort direction and failed request retry use real controls', async ({ browser }) => {
  test.setTimeout(90_000)
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  await page.goto('/editorial/leaderboard', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.route('**/api/editorial/leaderboard?*', r => r.fulfill({ status: 503, json: { error: 'Leaderboard unavailable' } }))
  await page.getByRole('button', { name: 'This Week', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Leaderboard unavailable' })).toBeVisible()
  await page.unroute('**/api/editorial/leaderboard?*')
  const retried = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/leaderboard')
  await page.getByRole('button', { name: 'Retry leaderboard' }).click()
  expect((await retried).status()).toBe(200)
  for (const [label, period] of [['This Month', 'month'], ['This Week', 'week'], ['All Time', 'alltime']]) {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/leaderboard' && new URL(r.url()).searchParams.get('period') === period)
    await page.getByRole('button', { name: label, exact: true }).click()
    expect((await response).status()).toBe(200)
  }
  for (const label of ['#', 'Articles', 'Reading Mins', 'Avg Read %', 'Avg Views', 'Comments']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: label, exact: true }).click()
  }
  await ctx.close()
})
