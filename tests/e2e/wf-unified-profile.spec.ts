import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  closeDb,
  createAccount,
  db,
  hydrated,
  removeMyAccounts,
  signedIn,
  signInAs,
  withCookieConsentAnswered,
  type TestAccount,
} from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'
import { makePng } from './helpers/e2eUtils'

/**
 * One contributor profile: the account page (/profile), the editorial Team Profile and the admin
 * Team Members editor all edit the same name, biography and photo, and every public surface (Our
 * Team, the author page) shows what was saved. Details that differed before the two were joined
 * are kept until the person chooses.
 */
test.afterAll(async () => {
  await removeMyAccounts() // their team cards cascade with them
  await closeDb()
})

const DETAILED = 'A detailed account biography with context on monetary policy, written on the account page.'

async function contributor(label: string, opts: { accountBio?: string | null; cardBio?: string; isActive?: boolean } = {}) {
  const account = await createAccount('WRITER', label)
  await db().user.update({ where: { id: account.id }, data: { bio: opts.accountBio === undefined ? 'Same bio.' : opts.accountBio, image: null } })
  const card = await db().teamMember.create({
    data: { userId: account.id, name: account.name, role: 'Writer', publicTier: 'writer', bio: opts.cardBio ?? 'Same bio.', order: 6000, isActive: opts.isActive ?? true },
  })
  return { account, card }
}

async function settings(page: Page) {
  await page.goto('/profile?tab=settings', { waitUntil: 'networkidle' })
  const bio = page.getByPlaceholder('Tell us a little about yourself...')
  await hydrated(bio, 'onChange')
  return bio
}

async function teamProfile(page: Page) {
  await page.goto('/editorial/team-profile', { waitUntil: 'networkidle' })
  const bio = page.locator('#tp-bio')
  await hydrated(bio, 'onChange')
  return bio
}

const accountRow = (id: string) => db().user.findUniqueOrThrow({ where: { id } })
const cardRow = (userId: string) => db().teamMember.findUniqueOrThrow({ where: { userId } })

async function expectPublic(browser: Browser, account: TestAccount, text: string) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  await page.goto('/team', { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: `View full profile for ${account.name}` })).toHaveCount(1)
  await expect(page.locator('main').getByText(text).first()).toBeVisible()
  await page.goto(`/author/${account.id}`, { waitUntil: 'networkidle' })
  await expect(page.locator('main').getByText(text, { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  await ctx.close()
}

test('the account page and the Team Profile edit one profile; previews and public pages agree', async ({ browser }) => {
  test.setTimeout(150_000)
  const { account } = await contributor('one-profile', { accountBio: DETAILED, cardBio: 'Short card bio.' })
  const ctx = await withCookieConsentAnswered(await signInAs(browser, account))
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)

  // The account page explains the link prominently and shows the team profile's version, with the
  // account's own different text offered rather than lost.
  const bio = await settings(page)
  await expect(page.getByTestId('linked-profile-banner')).toBeVisible()
  await expect(page.getByTestId('linked-profile-banner').getByRole('link', { name: 'Open your Team Profile' })).toHaveAttribute('href', '/editorial/team-profile')
  await expect(bio).toHaveValue('Short card bio.')
  await expect(page.getByTestId('differs-bio')).toContainText(DETAILED)
  await expect(page.getByTestId('preview-status')).toHaveText('As shown publicly now')

  // The preview follows the form, on both public surfaces.
  const typed = 'Edited on the account page: writes on markets.'
  await bio.fill(typed)
  await expect(page.getByTestId('preview-status')).toHaveText('Preview of unsaved changes')
  await expect(page.getByTestId('preview-author-bio')).toHaveText(typed)
  await expect(page.getByTestId('preview-team-bio')).toHaveText(typed)

  const saved = page.waitForResponse((r) => r.url().endsWith('/api/profile/account') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  expect((await saved).status()).toBe(200)
  // The save refreshes the server-rendered page; let that finish before navigating away.
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect((await accountRow(account.id)).bio).toBe(typed)
  expect((await cardRow(account.id)).bio).toBe(typed)
  await expect(page.getByTestId('differs-bio')).toHaveCount(0)

  // Test A: the Team Profile, after a reload, and the public pages show it.
  await expect(await teamProfile(page)).toHaveValue(typed)
  await expectPublic(browser, account, typed)

  // Test B: edit on the Team Profile; the account page follows.
  const second = 'Edited on the Team Profile: covers fiscal policy.'
  await page.locator('#tp-bio').fill(second)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Your team profile has been saved' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(await settings(page)).toHaveValue(second)
  await expectPublic(browser, account, second)

  // Phone width: no horizontal scroll on the account settings with the banner and preview.
  await page.setViewportSize({ width: 390, height: 844 })
  await settings(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
  await ctx.close()
})

test('choosing a version of a detail that differs saves it everywhere at once', async ({ browser }) => {
  const { account } = await contributor('choose', { accountBio: DETAILED, cardBio: 'Short card bio.' })
  const ctx = await withCookieConsentAnswered(await signInAs(browser, account))
  const page = await ctx.newPage()
  await teamProfile(page)
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/team-profile') && r.request().method() === 'PUT')
  await page.getByTestId('differs-bio').getByRole('button', { name: 'Use this version' }).click()
  expect((await saved).status()).toBe(200)
  await expect(page.locator('#tp-bio')).toHaveValue(DETAILED)
  await expect(page.getByTestId('differing-details')).toHaveCount(0)
  expect((await cardRow(account.id)).bio).toBe(DETAILED)
  const log = await db().auditLog.findFirstOrThrow({ where: { targetId: account.id, action: 'CONTRIBUTOR_PROFILE_UPDATED' } })
  expect(log.metadata).toMatchObject({ previous: { card: { bio: 'Short card bio.' } } })
  await ctx.close()
})

test('photos: uploaded on the account page, removed on the Team Profile, consistent everywhere', async ({ browser }) => {
  test.setTimeout(120_000)
  const { account } = await contributor('photo')
  const ctx = await withCookieConsentAnswered(await signInAs(browser, account))
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)

  await settings(page)
  const uploaded = page.waitForResponse((r) => r.url().endsWith('/api/profile/account') && r.request().method() === 'PATCH')
  await page.locator('input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: makePng(96, [30, 90, 160]) })
  expect((await uploaded).status()).toBe(200)
  await page.waitForLoadState('networkidle')
  const accountImage = (await accountRow(account.id)).image
  expect(accountImage).toContain(`/avatars/${account.id}/`)
  expect((await cardRow(account.id)).image).toBe(accountImage)

  const pub = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage()
  await pub.goto('/team', { waitUntil: 'networkidle' })
  await expect(pub.getByRole('img', { name: new RegExp(`^${account.name},`) })).toHaveAttribute('src', new RegExp(encodeURIComponent(`avatars/${account.id}/`)))
  await pub.context().close()

  await teamProfile(page)
  await page.getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Your team profile has been saved' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect((await accountRow(account.id)).image).toBeNull()
  expect((await cardRow(account.id)).image).toBeNull()
  await settings(page)
  await expect(page.getByRole('button', { name: 'Upload Photo' })).toBeVisible()
  expect(errors).toEqual([])
  await ctx.close()
})

test('an administrator edits the biography in Team Members; the account follows, permissions and placement do not move', async ({ browser }) => {
  test.setTimeout(150_000)
  const { account, card } = await contributor('admin-edit', { isActive: false })
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await admin.newPage()
  const errors = collectConsoleErrors(page)
  await page.goto('/editorial/members')
  await expect(page.getByRole('heading', { name: 'Team Members', level: 1 })).toBeVisible()
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important }' })
  await hydrated(page.getByLabel('Search'), 'onChange')
  await page.getByLabel('Search').fill(account.email)
  const row = page.getByTestId(`member-${account.email}`)
  await row.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: 'Public profile' }).click()
  await expect(page.getByTestId('shared-account-note')).toContainText(account.email)

  const text = 'Biography written by an administrator.'
  await page.locator(`#pf-bio-${card.id}`).fill(text)
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/team/${card.id}`) && r.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save public details' }).click()
  expect((await saved).status()).toBe(200)

  const [user, after] = await Promise.all([accountRow(account.id), cardRow(account.id)])
  expect(user).toMatchObject({ bio: text, role: 'WRITER' })
  expect(after).toMatchObject({ bio: text, role: 'Writer', publicTier: 'writer', order: 6000, isActive: false, userId: account.id })
  expect(errors).toEqual([])
  await admin.close()

  // Test G as well: the hidden card stays hidden, and the member sees the new text at once.
  const member = await withCookieConsentAnswered(await signInAs(browser, account))
  const own = await member.newPage()
  await expect(await settings(own)).toHaveValue(text)
  await expect(own.getByTestId('linked-profile-banner')).toContainText('hidden')
  await member.close()
})
