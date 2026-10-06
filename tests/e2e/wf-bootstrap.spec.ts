import { test, expect, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { assertRunDatabase } from '../../scripts/lib/assertRunDatabase'
import { db, closeDb, signedIn, uniqueTitle } from './helpers/workflow'

test.afterAll(closeDb)

test('first-admin controls retain failed input, validate, create exactly one administrator under contention and refuse takeover', async ({ browser }, testInfo) => {
  // This conditional workflow needs an empty-admin fixture. Only the attested,
  // disposable database and a single worker may temporarily alter seeded roles.
  assertRunDatabase()
  expect(testInfo.config.workers, 'Bootstrap fixture cannot run alongside another worker').toBe(1)
  const actual = await db().$queryRaw<{ database: string }[]>`SELECT current_database() AS database`
  expect(actual[0].database).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1))
  // Two browser forms, negative controls and a fresh authenticated page: an
  // aggregate deadline, with ordinary action/navigation deadlines unchanged.
  test.setTimeout(150_000)
  const seeded = await db().user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })
  expect(seeded.length).toBeGreaterThan(0)
  const ids = seeded.map(user => user.id)
  const emails = [0, 1].map(i => `${uniqueTitle(`bootstrap${i}`).replaceAll(' ', '').toLowerCase()}@consilium.test`)
  const password = 'Controlled-bootstrap-123'
  const contexts = await Promise.all([signedIn(browser, null), signedIn(browser, null)])
  const articleCount = await db().article.count()
  const errors: string[] = []
  try {
    await db().user.updateMany({ where: { id: { in: ids } }, data: { role: 'READER' } })
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()))
    for (const page of pages) {
      page.on('pageerror', error => errors.push(error.message))
      expect((await page.goto('/editorial/setup', { waitUntil: 'networkidle' }))?.status()).toBe(200)
      await expect(page.getByText('First-Time Setup', { exact: true })).toBeVisible()
    }
    const submit = (page: Page) => page.getByRole('button', { name: 'Create Admin Account', exact: true })
    const alert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)')
    const fill = async (page: Page, index: number) => {
      await page.getByLabel('Full Name', { exact: true }).fill(`Controlled Admin ${index}`)
      await page.getByLabel('Email', { exact: true }).fill(emails[index])
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByLabel('Confirm Password', { exact: true }).fill(password)
    }
    const page = pages[0]
    await submit(page).click()
    expect(await page.getByLabel('Full Name', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
    await fill(page, 0)
    await page.getByLabel('Password', { exact: true }).fill('short')
    await page.getByLabel('Confirm Password', { exact: true }).fill('short')
    await submit(page).click()
    await expect(alert(page)).toHaveText('Password must be at least 8 characters.')
    await page.getByLabel('Password', { exact: true }).fill(password)
    await submit(page).click()
    await expect(alert(page)).toHaveText('Passwords do not match.')
    await fill(page, 0)
    await page.route('**/api/editorial/setup', route => route.fulfill({ status: 503, json: { error: 'Controlled setup unavailable' } }))
    const unavailable = page.waitForResponse(response => new URL(response.url()).pathname === '/api/editorial/setup')
    await submit(page).click()
    expect((await unavailable).status()).toBe(503)
    await expect(alert(page)).toHaveText('Controlled setup unavailable')
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(emails[0])
    await expect(submit(page)).toBeEnabled()
    await page.unroute('**/api/editorial/setup')
    await page.route('**/api/editorial/setup', route => route.abort('failed'))
    await submit(page).click()
    await expect(alert(page)).toContainText('Check your connection and try again.')
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(password)
    await expect(submit(page)).toBeEnabled()
    await page.unroute('**/api/editorial/setup')
    expect(await db().user.count({ where: { role: 'ADMIN' } })).toBe(0)
    await fill(pages[1], 1)
    const responses = pages.map(page => page.waitForResponse(response => new URL(response.url()).pathname === '/api/editorial/setup' && response.request().method() === 'POST'))
    await Promise.all(pages.map(page => submit(page).click()))
    const statuses = (await Promise.all(responses)).map(response => response.status())
    expect([...statuses].sort()).toEqual([200, 403])
    const winner = statuses.indexOf(200)
    const loser = 1 - winner
    await pages[winner].waitForURL('**/editorial/login')
    await expect(alert(pages[loser])).toHaveText('Setup already completed.')
    await expect(pages[loser].getByLabel('Email', { exact: true })).toHaveValue(emails[loser])
    const admins = await db().user.findMany({ where: { role: 'ADMIN' } })
    expect(admins).toHaveLength(1)
    expect(admins[0].email).toBe(emails[winner])
    expect(await bcrypt.compare(password, admins[0].password!)).toBe(true)
    expect(await db().user.findUnique({ where: { email: emails[loser] } })).toBeNull()
    expect((await pages[loser].request.post('/api/editorial/setup', { data: { name: 'Refused takeover', email: emails[loser], password } })).status()).toBe(403)
    await pages[loser].goto('/editorial/setup', { waitUntil: 'networkidle' })
    await expect(pages[loser]).toHaveURL(/\/editorial\/login$/)
    const login = pages[winner]
    await login.getByLabel('Email', { exact: true }).fill(emails[winner])
    await login.getByLabel('Password', { exact: true }).fill(password)
    const authenticated = login.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/callback/credentials')
    await login.getByRole('button', { name: 'Sign In', exact: true }).click()
    expect((await authenticated).status()).toBe(200)
    await login.waitForURL(url => url.pathname === '/editorial')
    const fresh = await contexts[winner].newPage()
    expect((await fresh.goto('/editorial', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    const session = await fresh.request.get('/api/auth/session')
    expect(session.status()).toBe(200)
    expect((await session.json()).user.email).toBe(emails[winner])
    expect(await db().article.count()).toBe(articleCount)
    expect(errors).toEqual([])
    await fresh.screenshot({ path: testInfo.outputPath('first-admin-authenticated.png'), fullPage: true })
  } finally {
    try { await Promise.all(contexts.map(ctx => ctx.close())) } finally {
      try { await db().user.deleteMany({ where: { email: { in: emails } } }) } finally {
        await db().user.updateMany({ where: { id: { in: ids } }, data: { role: 'ADMIN' } })
      }
    }
    expect(await db().user.count({ where: { id: { in: ids }, role: 'ADMIN' } })).toBe(ids.length)
  }
})
