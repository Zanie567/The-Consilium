import { test, expect, type Page } from '@playwright/test'
import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import fs from 'node:fs/promises'
import {
  signedIn,
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
