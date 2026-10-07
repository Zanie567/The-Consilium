import { test, expect, type Page } from '@playwright/test'
import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import fs from 'node:fs/promises'
import {
  signedIn,
  signInAs,
  createAccount,
  removeMyAccounts,
  db,
  closeDb,
  capturedEmails,
  ArticleEditorPage,
  uniqueTitle,
} from './helpers/workflow'
import { makePng } from './helpers/e2eUtils'

const ownedEmails: string[] = []
test.afterAll(async () => {
  for (const email of ownedEmails) {
    await db().subscriber.deleteMany({ where: { email } })
    await db().user.deleteMany({ where: { email } })
  }
  await removeMyAccounts()
  await closeDb()
})
function email(label: string) {
  const e = `wf.${label}.${uniqueTitle('account').replaceAll(' ', '').toLowerCase()}@consilium.test`
  ownedEmails.push(e)
  return e
}
async function resetRequest(page: Page, address: string) {
  const before = capturedEmails().filter((m) => m.to === address).length
  await page.goto('/forgot-password', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.getByPlaceholder('you@example.com').fill(address)
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/forgot-password') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Send Reset Link' }).click()
  expect((await response).status()).toBe(200)
  await expect
    .poll(() => capturedEmails().filter((m) => m.to === address).length)
    .toBeGreaterThan(before)
  const message = capturedEmails()
    .filter((m) => m.to === address)
    .at(-1)!
  expect(message.html).toContain('expires in 1 hour')
  const url = message.html.match(/href="([^"]*reset-password\?token=[^"]+)"/)![1]
  expect(new URL(url).origin).toBe(new URL(process.env.E2E_BASE_URL!).origin)
  return url
}

test('password reset follows captured email; validation, token expiry, reuse and login work', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const address = email('reset')
  await db().user.create({
    data: {
      email: address,
      name: 'Reset account',
      role: 'READER',
      password: await bcrypt.hash('Old-password-123', 10),
    },
  })
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  const url = await resetRequest(page, address)
  await page.goto(url, { waitUntil: 'networkidle' })
  const input = page.getByPlaceholder('At least 8 characters')
  await input.fill('short')
  await page.getByRole('button', { name: 'Set New Password' }).click()
  expect(await input.evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true)
  await input.fill('New-password-123')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(input).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/forgot-password') && r.request().method() === 'PATCH'
  )
  await page.getByRole('button', { name: 'Set New Password' }).click()
  expect((await response).status()).toBe(200)
  await expect(page.getByText('Password updated.', { exact: false })).toBeVisible()
  await page.waitForURL('**/login')
  await page.locator('input[type=email]').fill(address)
  await page.locator('input[type=password]').fill('New-password-123')
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => u.pathname !== '/login')
  await page.goto(url, { waitUntil: 'networkidle' })
  await input.fill('Another-password-123')
  const used = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/forgot-password') && r.request().method() === 'PATCH'
  )
  await page.getByRole('button', { name: 'Set New Password' }).click()
  expect((await used).status()).toBe(400)
  await expect(page.getByText('This link has expired or already been used.')).toBeVisible()
  const expiredUrl = await resetRequest(page, address)
  const token = new URL(expiredUrl).searchParams.get('token')!
  await db().passwordResetToken.update({
    where: { token },
    data: { expires: new Date(Date.now() - 1000) },
  })
  await page.goto(expiredUrl, { waitUntil: 'networkidle' })
  await input.fill('Another-password-123')
  const expired = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/forgot-password') && r.request().method() === 'PATCH'
  )
  await page.getByRole('button', { name: 'Set New Password' }).click()
  expect((await expired).status()).toBe(400)
  await expect(page.getByText('This link has expired or already been used.')).toBeVisible()
  await ctx.close()
})

test('newsletter signup, duplicate, subscriber search/export and signed unsubscribe use real controls', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const address = email('subscribe')
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  for (const status of [201, 200]) {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    const form=page.locator('form').filter({has:page.getByPlaceholder('Your email address')}).first()
    await form.getByPlaceholder('Your email address').fill(address)
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/subscribe') && r.request().method() === 'POST'
    )
    await form.getByRole('button', { name: 'Subscribe', exact: true }).click()
    expect((await response).status()).toBe(status)
    await expect(page.getByText('Thank you for subscribing to The Consilium.')).toBeVisible()
  }
  expect(await db().subscriber.count({ where: { email: address } })).toBe(1)
  const growth = await signedIn(browser, 'growth')
  const portal = await growth.newPage()
  await portal.goto('/editorial/growth/subscribers', { waitUntil: 'networkidle' })
  await portal.getByPlaceholder('Search by email…').fill(address)
  await expect(portal.locator('tbody tr')).toHaveCount(1)
  const download = portal.waitForEvent('download')
  await portal.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^subscribers-.*\.csv$/)
  expect(await fs.readFile((await file.path())!, 'utf8')).toContain(address)
  await portal.getByPlaceholder('Search by email…').fill('no-subscriber-here')
  await expect(portal.getByText('No subscribers match your search.')).toBeVisible()
  const token = createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(address).digest('hex')
  // Signing is fixture preparation: newsletter transport itself is unavailable locally.
  await page.goto(`/unsubscribe?email=${encodeURIComponent(address)}&token=bad`, {
    waitUntil: 'networkidle',
  })
  await expect(page.getByText('This unsubscribe link is not valid or has expired.')).toBeVisible()
  expect(await db().subscriber.count({ where: { email: address } })).toBe(1)
  expect(
    (await page.goto(`/unsubscribe?email=${encodeURIComponent(address)}&token=${token}`, {
      waitUntil: 'networkidle',
    }))!.status()
  ).toBe(200)
  await expect(page.getByRole('heading', { name: 'Unsubscribed' })).toBeVisible()
  expect(await db().subscriber.count({ where: { email: address } })).toBe(0)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Unsubscribed' })).toBeVisible()
  await growth.close()
  await ctx.close()
})

test('reader avatar upload persists on fresh page and can be removed', async ({ browser }) => {
  const address = email('avatar')
  const user = await db().user.create({
    data: {
      email: address,
      name: 'Avatar reader',
      role: 'READER',
      password: await bcrypt.hash('Avatar-password-123', 10),
    },
  })
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  await page.goto('/login', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.locator('input[type=email]').fill(address)
  await page.locator('input[type=password]').fill('Avatar-password-123')
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => u.pathname !== '/login')
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Account Settings', exact: true }).click()
  const upload = page.waitForResponse(
    (r) => r.url().endsWith('/api/upload') && r.request().method() === 'POST'
  )
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: makePng(64) })
  expect((await upload).status()).toBe(201)
  await expect
    .poll(async () => (await db().user.findUnique({ where: { id: user.id } }))?.image)
    .toContain('/avatars/')
  const fresh = await ctx.newPage()
  await fresh.goto('/profile', { waitUntil: 'networkidle' })
  await fresh.getByRole('button', { name: 'Account Settings', exact: true }).click()
  await expect(fresh.getByRole('button', { name: 'Change Photo' })).toBeVisible()
  const remove = fresh.waitForResponse(
    (r) => r.url().endsWith('/api/profile/account') && r.request().method() === 'PATCH'
  )
  await fresh.getByRole('button', { name: 'Remove', exact: true }).click()
  expect((await remove).status()).toBe(200)
  await expect
    .poll(async () => (await db().user.findUnique({ where: { id: user.id } }))?.image)
    .toBeNull()
  await ctx.close()
})

test('two reset forms cannot consume the same token twice', async ({ browser }) => {
  const address = email('reset-race')
  await db().user.create({
    data: { email: address, role: 'READER', password: await bcrypt.hash('Old-password-123', 10) },
  })
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  const url = await resetRequest(page, address)
  const other = await ctx.newPage()
  await Promise.all([
    page.goto(url, { waitUntil: 'networkidle' }),
    other.goto(url, { waitUntil: 'networkidle' }),
  ])
  for (const p of [page, other])
    await p.getByPlaceholder('At least 8 characters').fill('New-password-123')
  const responses = [page, other].map((p) =>
    p.waitForResponse(
      (r) => r.url().endsWith('/api/auth/forgot-password') && r.request().method() === 'PATCH'
    )
  )
  await Promise.all(
    [page, other].map((p) => p.getByRole('button', { name: 'Set New Password' }).click())
  )
  expect((await Promise.all(responses)).map((r) => r.status()).sort()).toEqual([200, 400])
  await ctx.close()
})

test('legacy editorial login/reset controls retain failed requests, validate confirmation, expire links and sign in with the persisted password', async ({ browser }) => {
  test.setTimeout(150_000) // Separate request failures, reset states and fresh login; normal per-action deadlines apply.
  const writer = await createAccount('WRITER', 'legacy-reset')
  const ctx = await signedIn(browser, null)
  try {
    const page = await ctx.newPage()
    const path = '/api/editorial/password-reset'
    let resetRequests = 0
    const requestLink = async () => {
      // Each request starts from a fresh document URL; this tests a full successful
      // load rather than an engine-specific ETag revalidation (304 in WebKit).
      expect((await page.goto(`/editorial/login?reset-request=${++resetRequests}`, { waitUntil: 'networkidle' }))?.status()).toBe(200)
      await new ArticleEditorPage(page).dismissCookieBanner()
      await page.getByRole('button', { name: 'Forgot password?' }).click()
      await page.getByPlaceholder('your@email.com').fill(writer.email)
      const before = capturedEmails().filter(message => message.to === writer.email).length
      const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click()
      expect((await response).status()).toBe(200)
      await expect(page.getByText(/receive a reset link shortly/)).toBeVisible()
      await expect.poll(() => capturedEmails().filter(message => message.to === writer.email).length).toBeGreaterThan(before)
      const message = capturedEmails().filter(message => message.to === writer.email).at(-1)!
      expect(message.html).toContain('expires in 1 hour')
      const url = message.html.match(/href="([^"]*\/editorial\/reset-password\?token=[^"]+)"/)![1]
      expect(new URL(url).origin).toBe(new URL(process.env.E2E_BASE_URL!).origin)
      await page.getByRole('button', { name: '← Back to login' }).click()
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
      return url
    }
    await page.goto('/editorial/login', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await page.getByRole('button', { name: '← Back to login' }).click()
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    const emailInput = page.getByPlaceholder('your@email.com')
    await emailInput.fill(writer.email)
    await page.route(`**${path}`, r => r.fulfill({ status: 503, json: { error: 'Controlled reset outage' } }))
    const refused = page.waitForResponse(r => new URL(r.url()).pathname === path)
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click()
    expect((await refused).status()).toBe(503)
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText('Reset request failed. Please try again.')
    await expect(emailInput).toHaveValue(writer.email)
    await expect(page.getByText(/receive a reset link shortly/)).toHaveCount(0)
    await page.unroute(`**${path}`)
    await page.route(`**${path}`, r => r.abort('failed'))
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click()
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Check your connection and try again.')
    await expect(emailInput).toHaveValue(writer.email)
    await expect(page.getByRole('button', { name: 'Send Reset Link', exact: true })).toBeEnabled()
    await page.unroute(`**${path}`)
    const url = await requestLink()
    expect((await page.goto('/editorial/reset-password', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    await expect(page.getByText('Invalid or missing reset link.')).toBeVisible()
    await page.goto(url, { waitUntil: 'networkidle' })
    const password = page.getByLabel('New Password', { exact: true })
    const confirmation = page.getByLabel('Confirm Password', { exact: true })
    await password.fill('short')
    await confirmation.fill('short')
    await page.getByRole('button', { name: 'Reset Password', exact: true }).click()
    expect(await password.evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true)
    const newPassword = 'Controlled-legacy-password-123'
    await password.fill(newPassword)
    await confirmation.fill('Different-password-123')
    await page.getByRole('button', { name: 'Reset Password', exact: true }).click()
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText('Passwords do not match.')
    expect((await db().passwordResetToken.findUniqueOrThrow({ where: { token: new URL(url).searchParams.get('token')! } })).used).toBe(false)
    await confirmation.fill(newPassword)
    const updated = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Reset Password', exact: true }).click()
    expect((await updated).status()).toBe(200)
    await page.waitForURL('**/editorial/login')
    expect(await bcrypt.compare(newPassword, (await db().user.findUniqueOrThrow({ where: { id: writer.id } })).password!)).toBe(true)
    await page.getByLabel('Email', { exact: true }).fill(writer.email)
    await page.getByLabel('Password', { exact: true }).fill(newPassword)
    const authenticated = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/callback/credentials')
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    expect((await authenticated).status()).toBe(200)
    await page.waitForURL(u => u.pathname === '/editorial')
    const fresh = await ctx.newPage()
    expect((await fresh.goto('/editorial', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    expect((await fresh.request.get('/api/auth/session')).status()).toBe(200)
    await fresh.close()
    for (const resetUrl of [url, await requestLink()]) {
      if (resetUrl !== url) await db().passwordResetToken.update({ where: { token: new URL(resetUrl).searchParams.get('token')! }, data: { expires: new Date(Date.now() - 1000) } })
      await page.goto(resetUrl, { waitUntil: 'networkidle' })
      await password.fill('Refused-password-123')
      await confirmation.fill('Refused-password-123')
      const refusal = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Reset Password', exact: true }).click()
      expect((await refusal).status()).toBe(400)
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText('This link has expired or already been used.')
      expect(await bcrypt.compare(newPassword, (await db().user.findUniqueOrThrow({ where: { id: writer.id } })).password!)).toBe(true)
    }
    expect(await db().article.count({ where: { authorId: writer.id } })).toBe(0)
  } finally { await ctx.close() }
})

test('reader biography failure/retry, fresh persisted settings, no author-page sharing for readers and delete cancellation use real controls', async ({ browser }) => {
  const address = email('biography')
  const user = await db().user.create({ data: { email: address, name: 'Biography reader', role: 'READER', password: await bcrypt.hash('Biography-password-123', 10) } })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/login')
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.locator('input[type=email]').fill(address)
  await page.locator('input[type=password]').fill('Biography-password-123')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(u => u.pathname !== '/login')
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Account Settings', exact: true }).click()
  const bio = 'A biography saved and reopened through reader settings.'
  await page.getByPlaceholder('Tell us a little about yourself...').fill(bio)
  await page.route('**/api/profile/account', r => r.request().method() === 'PATCH' ? r.fulfill({ status: 503, json: { error: 'Settings unavailable' } }) : r.continue())
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByText('Settings unavailable', { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('Tell us a little about yourself...')).toHaveValue(bio)
  await page.unroute('**/api/profile/account')
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/profile/account' && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  expect((await saved).status()).toBe(200)
  expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).bio).toBe(bio)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Account Settings', exact: true }).click()
  await expect(page.getByPlaceholder('Tell us a little about yourself...')).toHaveValue(bio)
  // A reader has no public author page, so nothing offers a link to share. In particular the
  // private /profile address is not offered as one.
  await expect(page.getByRole('heading', { name: 'Share Your Author Page' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Delete Account', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await db().user.findUnique({ where: { id: user.id } })).not.toBeNull()
  await ctx.close()
})

test('a writer copies the public author link; a signed-out visitor and another signed-in person see only that public page', async ({ browser, browserName }) => {
  const writer = await createAccount('WRITER', 'share-author')
  const visitor = await createAccount('READER', 'share-visitor')
  const bio = 'Public biography shown on the shared author page.'
  await db().user.update({ where: { id: writer.id }, data: { bio } })
  const { slug } = await db().user.findUniqueOrThrow({ where: { id: writer.id }, select: { slug: true } })
  expect(slug).toBeTruthy()

  const ctx = await signInAs(browser, writer)
  const page = await ctx.newPage()
  await page.goto('/profile?tab=settings', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await expect(page.getByRole('heading', { name: 'Share Your Author Page' })).toBeVisible()
  await expect(page.getByText('Your email address and account settings are never shown.')).toBeVisible()

  // A denied clipboard is reported, not swallowed.
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Controlled clipboard denial') } } }) })
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not copy the link.' })).toBeVisible()

  // Exercise the real clipboard boundary; Chromium additionally reads its contents back.
  await page.evaluate(() => Reflect.deleteProperty(navigator, 'clipboard'))
  if (browserName === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  const link = new URL(`/author/${slug}`, page.url()).href
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  expect(new URL(link).pathname).not.toContain('/profile')

  const publicPage = async (visitorPage: Page) => {
    await visitorPage.goto(link, { waitUntil: 'networkidle' })
    await expect(visitorPage).toHaveURL(link)
    await expect(visitorPage.getByRole('heading', { level: 1, name: writer.name })).toBeVisible()
    await expect(visitorPage.getByText(bio, { exact: true })).toBeVisible()
    for (const privateText of [writer.email, visitor.email, 'Account Settings', 'Delete Account', 'Share Your Author Page'])
      await expect(visitorPage.locator('body')).not.toContainText(privateText)
  }

  const signedOut = await signedIn(browser, null)
  await publicPage(await signedOut.newPage())
  await signedOut.close()

  const other = await signInAs(browser, visitor)
  await publicPage(await other.newPage())
  await other.close()
  await ctx.close()
})
