import { test, expect } from '@playwright/test'
import { ArticleEditorPage, closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signInAs, signedIn, uniqueTitle } from './helpers/workflow'

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
  await expect(page).toHaveURL(new URL('/archive', page.url()).href)
  await ctx.close()
})

test('Your Readers author selection, every sort and detail failure/retry display representative data', async ({ browser }) => {
  test.setTimeout(90_000)
  const author = await createAccount('WRITER', 'readers-controls')
  const rows: {id: string; title: string}[] = []
  for (let i = 0; i < 2; i++) {
    const title = uniqueTitle('Reader detail')
    rows.push(await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), content: 'Reader detail fixture', authorId: author.id, status: 'PUBLISHED', publishedAt: new Date(Date.now() - i * 86400000) } }))
  }
  const ctx = await signedIn(browser, 'admin')
  const page = await ctx.newPage()
  await page.goto('/editorial/readers', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const listed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/read-through' && new URL(r.url()).searchParams.get('authorId') === author.id)
  await page.getByRole('combobox', { name: 'Author', exact: true }).selectOption(author.id)
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
  const detailCard = page.getByRole('heading', { name: `Where readers get to: ${rows[0].title}`, exact: true }).locator('..').locator('..')
  await expect(detailCard.getByText('Not enough data yet', { exact: true })).toBeVisible()
  const readers = []
  for (let i = 0; i < 5; i++) readers.push(await createAccount('READER', 'retention-controls'))
  await db().readingProgress.createMany({ data: readers.map((user, i) => ({ userId: user.id, articleId: rows[0].id, progress: 100 - i * 15, completed: i === 0 })) })
  const enough = page.waitForResponse(r => new URL(r.url()).pathname === detail)
  await page.locator('tr', { hasText: rows[0].title }).click()
  expect((await enough).status()).toBe(200)
  await expect(page.locator('canvas')).toBeVisible()
  await expect(detailCard.getByText('Not enough data yet', { exact: true })).toHaveCount(0)
  await page.reload({ waitUntil: 'networkidle' })
  const refreshedList = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/read-through' && new URL(r.url()).searchParams.get('authorId') === author.id)
  await page.getByRole('combobox', { name: 'Author', exact: true }).selectOption(author.id)
  expect((await refreshedList).status()).toBe(200)
  await expect(page.locator('tbody tr')).toHaveCount(2)
  for (const label of ['Published', 'Signed-in readers', 'Finished', 'Median furthest point']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('tbody tr').first()).toContainText(label === 'Published' ? rows[1].title : rows[0].title)
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('tbody tr').first()).toContainText(label === 'Published' ? rows[0].title : rows[1].title)
  }
  let release = () => {}
  let started = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const observed = new Promise<void>(resolve => { started = resolve })
  await page.route(`**${detail}`, async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    started()
    await held
    await route.fulfill({ response })
  })
  try {
    await page.locator('tr', { hasText: rows[0].title }).click()
    await observed
    const latest = page.waitForResponse(r => new URL(r.url()).pathname === `/api/editorial/read-through/${rows[1].id}`)
    await page.locator('tr', { hasText: rows[1].title }).click()
    expect((await latest).status()).toBe(200)
    const latestHeading = page.getByRole('heading', { name: `Where readers get to: ${rows[1].title}`, exact: true })
    await expect(latestHeading).toBeVisible()
    const old = page.waitForResponse(r => new URL(r.url()).pathname === detail)
    release()
    const oldResponse = await old
    expect(oldResponse.status()).toBe(200)
    await oldResponse.finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await expect(latestHeading).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
  } finally { release(); await ctx.close() }
})

test('writer leaderboard every period, sort direction and failed request retry use real controls', async ({ browser }) => {
  test.setTimeout(90_000)
  const author = await createAccount('WRITER', 'leaderboard-race')
  for (const publishedAt of [new Date('2025-01-01T12:00:00Z'), new Date()]) {
    const title = uniqueTitle('Leaderboard period fixture')
    await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), authorId: author.id, status: 'PUBLISHED', publishedAt, content: 'A controlled article for leaderboard period comparisons.' } })
  }
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
  for (const [label, column] of [['#', 0], ['Articles', 2], ['Reading Mins', 3], ['Avg Read %', 4], ['Avg Views', 5], ['Comments', 6]] as const) {
    const values = () => page.locator(`tbody tr td:nth-child(${column + 1})`).allInnerTexts().then(text => text.map(value => column === 0 && !value.trim() ? 1 : Number(value.replace(/[^0-9.-]/g, ''))))
    await page.getByRole('button', { name: label, exact: true }).click()
    const descending = await values()
    expect(descending.length).toBeGreaterThan(0)
    expect(descending).toEqual([...descending].sort((a, b) => b - a))
    await page.getByRole('button', { name: label, exact: true }).click()
    const ascending = await values()
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b))
  }
  let release = () => {}
  let started = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const observed = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/editorial/leaderboard?period=week', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    started()
    await held
    await route.fulfill({ response })
  })
  try {
    await page.getByRole('button', { name: 'This Week', exact: true }).click()
    await observed
    const latest = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/leaderboard' && new URL(r.url()).searchParams.get('period') === 'alltime')
    await page.getByRole('button', { name: 'All Time', exact: true }).click()
    const latestResponse = await latest
    expect(latestResponse.status()).toBe(200)
    const latestData = await latestResponse.json()
    await expect(page.locator('tbody tr')).toHaveCount(latestData.writers.length)
    const expectedRows = await page.locator('tbody tr').allInnerTexts()
    const old = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/leaderboard' && new URL(r.url()).searchParams.get('period') === 'week')
    release()
    const oldResponse = await old
    expect(oldResponse.status()).toBe(200)
    expect((await oldResponse.json()).writers).not.toEqual(latestData.writers)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    expect(await page.locator('tbody tr').allInnerTexts()).toEqual(expectedRows)
  } finally { release() }
  await ctx.close()
})


test('contact failure preserves every field, and each subject submits a persisted message through the form', async ({ browser }) => {
  test.setTimeout(90_000) // Five actual form submissions plus a failed attempt; normal action deadlines apply.
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  const email = `workflow-contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@consilium.test`
  try {
    for (const [index, subject] of ['writing', 'story', 'collaboration', 'feedback', 'other'].entries()) {
      const message = `Controlled workflow message ${subject}`
      await page.goto('/contact', { waitUntil: 'networkidle' })
      await new ArticleEditorPage(page).dismissCookieBanner()
      await page.getByPlaceholder('Your full name').fill('Controlled Workflow Contact')
      await page.getByPlaceholder('your@email.com').fill(email)
      await page.locator('select[name=subject]').selectOption(subject)
      await page.getByPlaceholder('Your message...').fill(message)
      if (index === 0) {
        await page.route('**/api/contact', r => r.fulfill({ status: 503, json: { error: 'Contact temporarily unavailable' } }))
        const failed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/contact')
        await page.getByRole('button', { name: 'Send Message', exact: true }).click()
        expect((await failed).status()).toBe(503)
        await expect(page.getByText('Contact temporarily unavailable', { exact: true })).toBeVisible()
        await expect(page.getByPlaceholder('Your full name')).toHaveValue('Controlled Workflow Contact')
        await expect(page.getByPlaceholder('your@email.com')).toHaveValue(email)
        await expect(page.locator('select[name=subject]')).toHaveValue(subject)
        await expect(page.getByPlaceholder('Your message...')).toHaveValue(message)
        expect(await db().contactMessage.count({ where: { email } })).toBe(0)
        await page.unroute('**/api/contact')
      }
      const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/contact' && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'Send Message', exact: true }).click()
      expect((await saved).status()).toBe(200)
      await expect(page.getByRole('heading', { name: 'Message sent', exact: true })).toBeVisible()
      expect(await db().contactMessage.count({ where: { email, subject, message, name: 'Controlled Workflow Contact' } })).toBe(1)
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.getByPlaceholder('Your message...')).toHaveValue('')
    }
  } finally { await db().contactMessage.deleteMany({ where: { email } }); await ctx.close() }
})

test('reader history pagination and populated profile row links lead to the correct articles', async ({ browser }) => {
  test.setTimeout(90_000)
  const author = await createAccount('WRITER', 'history-author')
  const reader = await createAccount('READER', 'history-pages')
  const prefix = uniqueTitle('History')
  const rows: { id: string; slug: string; title: string }[] = []
  for (let i = 0; i < 22; i++) {
    const title = `${prefix} ${i}`
    rows.push(await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), authorId: author.id, status: 'PUBLISHED', publishedAt: new Date(), content: 'Profile row navigation fixture.' } }))
  }
  await db().readingProgress.createMany({ data: rows.map((article, i) => ({ userId: reader.id, articleId: article.id, progress: i === 21 ? 40 : 100, completed: i !== 21, updatedAt: new Date(Date.now() - i * 1000) })) })
  await db().bookmark.create({ data: { userId: reader.id, articleId: rows[0].id } })
  await db().comment.create({ data: { userId: reader.id, articleId: rows[0].id, body: 'A controlled profile row comment.' } })
  const ctx = await signInAs(browser, reader)
  const page = await ctx.newPage()
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
  const next = page.waitForResponse(r => new URL(r.url()).pathname === '/api/profile/reading-history' && new URL(r.url()).searchParams.get('page') === '2')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  expect((await next).status()).toBe(200)
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await page.getByRole('link', { name: new RegExp(rows[20].title) }).click()
  await expect(page.locator('h1')).toHaveText(rows[20].title)
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  const previous = page.waitForResponse(r => new URL(r.url()).pathname === '/api/profile/reading-history' && new URL(r.url()).searchParams.get('page') === '1')
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  expect((await previous).status()).toBe(200)
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible()
  for (const [tab, article] of [['Currently Reading', rows[21]], ['Saved Articles', rows[0]], ['My Comments', rows[0]]] as const) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await page.getByRole('link', { name: new RegExp(article.title) }).click()
    await expect(page.locator('h1')).toHaveText(article.title)
    await page.goto('/profile', { waitUntil: 'networkidle' })
  }
  await ctx.close()
})

test('Admin and Growth analytics expose failed requests, retry exact 200, and retain the latest period', async ({ browser }) => {
  test.setTimeout(90_000) // Two roles, explicit failures and a controlled delayed period; ordinary action deadlines remain.
  for (const role of ['admin', 'growth'] as const) {
    const ctx = await signedIn(browser, role)
    const page = await ctx.newPage()
    const endpoint = '/api/editorial/analytics'
    await page.route('**/api/editorial/analytics?**', route => route.fulfill({ status: 503, json: { error: 'Controlled analytics outage' } }))
    const failed = page.waitForResponse(r => new URL(r.url()).pathname === endpoint)
    await page.goto('/editorial/analytics', { waitUntil: 'networkidle' })
    expect((await failed).status()).toBe(503)
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Analytics could not be loaded (503).')
    await new ArticleEditorPage(page).dismissCookieBanner()
    await page.unroute('**/api/editorial/analytics?**')
    const recovered = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && new URL(r.url()).searchParams.get('period') === '30d')
    await page.getByRole('button', { name: 'Retry analytics', exact: true }).click()
    const recovery = await recovered
    expect(recovery.status()).toBe(200)
    const recoveredData = await recovery.json()
    const value = (label: string) => page.getByText(label, { exact: true }).locator('..').locator('p').nth(1)
    await expect(value('Views: last 30 days')).toHaveText(recoveredData.summary.viewsInPeriod.toLocaleString())
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)
    let release = () => {}
    let entered = () => {}
    let finished = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const observed = new Promise<void>(resolve => { entered = resolve })
    const completed = new Promise<void>(resolve => { finished = resolve })
    await page.route('**/api/editorial/analytics?period=90d&tab=overview', async route => {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      entered()
      await held
      // Deliver the old data deliberately; the application owns cancellation/current selection.
      await route.fulfill({ response })
      finished()
    })
    try {
      await page.getByRole('button', { name: 'Last 30 days', exact: true }).click()
      await page.getByRole('button', { name: 'Last 90 days', exact: true }).click()
      await observed
      await page.getByRole('button', { name: 'Last 90 days', exact: true }).click()
      const current = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && new URL(r.url()).searchParams.get('period') === '7d')
      await page.getByRole('button', { name: 'Last 7 days', exact: true }).click()
      const response = await current
      expect(response.status()).toBe(200)
      const data = await response.json()
      await expect(value('Views: last 7 days')).toHaveText(data.summary.viewsInPeriod.toLocaleString())
      release()
      await completed
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      await expect(value('Views: last 7 days')).toHaveText(data.summary.viewsInPeriod.toLocaleString())
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)
    } finally { release(); await ctx.close() }
  }
})
