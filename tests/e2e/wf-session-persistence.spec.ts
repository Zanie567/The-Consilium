import { test, expect, type Browser, type BrowserContext } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { closeDb, createAccount, db, removeMyAccounts, signInAs, type TestAccount } from './helpers/workflow'

/**
 * A returning reader stays signed in: the session cookie is persistent (an expiry date, not a browser-session
 * cookie), lasts about 60 days, is renewed by ordinary visits, survives declining optional cookies, and is still
 * ended by signing out, a password reset, suspension or a role change. Real browser, real server, isolated database.
 * The 60-day boundary itself is proven with a controlled clock in tests/unit/session-cookie-lifetime.test.ts.
 */
test.describe.configure({ mode: 'serial' })
test.afterAll(async () => { await removeMyAccounts(); await closeDb() })

const DAY = 24 * 60 * 60

async function sessionCookie(context: BrowserContext) {
  const cookies = await context.cookies()
  return cookies.find((c) => /next-auth\.session-token$/.test(c.name))
}
async function sessionUser(context: BrowserContext) {
  const res = await context.request.get('/api/auth/session')
  return ((await res.json()) as { user?: { id: string; role: string } }).user ?? null
}
/** Closing and reopening the browser: only cookies with an expiry date survive; browser-session cookies are gone. */
async function restartBrowser(browser: Browser, context: BrowserContext) {
  const state = await context.storageState()
  await context.close()
  return browser.newContext({ storageState: { ...state, cookies: state.cookies.filter((c) => c.expires !== -1) } })
}
async function readerSignedIn(browser: Browser, label: string): Promise<{ account: TestAccount; context: BrowserContext }> {
  const account = await createAccount('READER', label)
  return { account, context: await signInAs(browser, account) }
}

test('the session cookie is persistent, protected, lasts about 60 days and survives a browser restart', async ({ browser }) => {
  const { account, context } = await readerSignedIn(browser, 'persist')
  const cookie = await sessionCookie(context)
  expect(cookie).toBeDefined()
  expect(cookie!.httpOnly).toBe(true)
  expect(cookie!.sameSite).toBe('Lax')
  expect(cookie!.expires).not.toBe(-1) // a dated cookie, not one that ends with the browser
  const days = (cookie!.expires - Date.now() / 1000) / DAY
  expect(days).toBeGreaterThan(59)
  expect(days).toBeLessThan(61)

  const reopened = await restartBrowser(browser, context)
  expect((await sessionUser(reopened))?.id).toBe(account.id)
  const page = await reopened.newPage()
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeAttached()
  await reopened.close()
})

test('a visit more than a day after the cookie was issued renews it through NextAuth', async ({ browser }) => {
  const { account, context } = await readerSignedIn(browser, 'renew')
  const page = await context.newPage()
  // The browser believes two days have passed, so the page asks NextAuth to re-issue the cookie.
  await page.clock.install({ time: new Date(Date.now() + 2 * DAY * 1000) })
  const renewal = page.waitForResponse((r) => r.url().endsWith('/api/auth/session') && r.request().method() === 'GET')
  await page.goto('/')
  const res = await renewal
  expect(res.status()).toBe(200)
  expect((await res.allHeaders())['set-cookie'] ?? '').toMatch(/next-auth\.session-token=/)
  expect(((await res.json()) as { user?: { id: string } }).user?.id).toBe(account.id)
  await context.close()
})

test('a visit within a day does not re-issue the cookie on every page', async ({ browser }) => {
  const { context } = await readerSignedIn(browser, 'norenew')
  const page = await context.newPage()
  const calls: string[] = []
  page.on('request', (r) => { if (r.url().endsWith('/api/auth/session')) calls.push(r.url()) })
  await page.goto('/')
  await page.goto('/team')
  await page.waitForLoadState('networkidle')
  expect(calls).toEqual([])
  await context.close()
})

test('declining or accepting optional cookies never touches the sign-in', async ({ browser }) => {
  for (const choice of ['Decline', 'Accept'] as const) {
    const { account, context } = await readerSignedIn(browser, `consent-${choice.toLowerCase()}`)
    const page = await context.newPage()
    await page.goto('/')
    const banner = page.getByRole('dialog', { name: 'Cookie consent' })
    await banner.getByRole('button', { name: choice }).click()
    await page.reload()
    expect((await sessionUser(context))?.id, choice).toBe(account.id)
    const reopened = await restartBrowser(browser, context)
    expect((await sessionUser(reopened))?.id, choice).toBe(account.id)
    await reopened.close()
  }
})

test('signing out ends the session, including after a restart', async ({ browser }) => {
  const { context } = await readerSignedIn(browser, 'signout')
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await expect.poll(async () => sessionUser(context)).toBeNull()
  expect(await sessionCookie(context)).toBeUndefined()
  const reopened = await restartBrowser(browser, context)
  expect(await sessionUser(reopened)).toBeNull()
  await reopened.close()
})

test('a password reset elsewhere signs out every existing browser at once', async ({ browser }) => {
  const { account, context } = await readerSignedIn(browser, 'reset')
  const other = await signInAs(browser, account) // a second device
  await db().user.update({ where: { id: account.id }, data: { password: await bcrypt.hash('a-brand-new-password', 10) } })
  for (const device of [context, other]) {
    expect(await sessionUser(device)).toBeNull()
  }
  await Promise.all([context.close(), other.close()])
})

test('suspension and a removed role apply on the next request, not when the cookie expires', async ({ browser }) => {
  const writer = await createAccount('WRITER', 'demote')
  const context = await signInAs(browser, writer)
  expect((await sessionUser(context))?.role).toBe('WRITER')
  expect((await context.request.get('/editorial', { maxRedirects: 0 })).status()).toBe(200)

  await db().user.update({ where: { id: writer.id }, data: { role: 'READER' } })
  expect((await sessionUser(context))?.role).toBe('READER')
  expect((await context.request.get('/api/editorial/users')).status()).toBeGreaterThanOrEqual(401)

  await db().user.update({ where: { id: writer.id }, data: { role: 'WRITER', isBanned: true } })
  expect((await sessionUser(context))?.role).toBe('READER')
  await context.close()
})
