import { test, expect, type Browser, type Page } from '@playwright/test'
import { closeDb, createAccount, db, removeMyAccounts, type TestAccount } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'
import { makePng } from './helpers/e2eUtils'

/**
 * /author/[slug] shows the photo and description of the author's PUBLIC Meet the Team card;
 * a hidden card is never read, so the page falls back to the account bio and initials.
 */
const STORAGE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'

test.afterAll(async () => {
  await removeMyAccounts() // their team cards cascade with them
  await closeDb()
})

async function storePhoto(userId: string, name: string): Promise<string> {
  const res = await fetch(`${STORAGE_URL}/storage/v1/object/avatars/${userId}/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer e2e', 'content-type': 'image/png' },
    body: new Uint8Array(makePng(96, [30, 90, 160])),
  })
  expect(res.ok).toBe(true)
  return `${STORAGE_URL}/storage/v1/object/public/avatars/${userId}/${name}`
}

async function author(label: string, card: { bio: string; isActive: boolean }) {
  const account = await createAccount('EDITOR', label)
  await db().user.update({ where: { id: account.id }, data: { bio: `${label} account bio.`, image: null } })
  const image = await storePhoto(account.id, `${label}.png`)
  await db().teamMember.create({
    data: { userId: account.id, name: account.name, role: 'Senior Editor', publicTier: 'senior_editor', bio: card.bio, image, order: 5000, isActive: card.isActive },
  })
  return { account, image }
}

const initials = (account: TestAccount) => {
  const parts = account.name.trim().split(/\s+/)
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

async function open(browser: Browser, account: TestAccount, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', ...(viewport ? { viewport } : {}) })
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  await page.goto(`/author/${account.id}`, { waitUntil: 'networkidle' })
  await expect(page.locator('main h1')).toHaveText(account.name)
  return { ctx, page, errors }
}

async function expectRoundPhoto(page: Page, account: TestAccount, storedKey: string) {
  const img = page.getByRole('img', { name: account.name, exact: true })
  await expect(img).toBeVisible()
  await expect(img).toHaveAttribute('src', new RegExp(encodeURIComponent(storedKey)))
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  const box = await img.boundingBox()
  expect(box && Math.round(box.width) === Math.round(box.height)).toBe(true)
  expect(await img.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(box!.width / 2)
  await expect(page.getByText(initials(account), { exact: true })).toHaveCount(0)
  return img
}

test('a public team card supplies the author page photo and description, on desktop and phone', async ({ browser }) => {
  test.setTimeout(90_000)
  const bio = 'Public card description: writes on monetary policy and markets.'
  const { account } = await author('author-public-card', { bio, isActive: true })
  const key = `avatars/${account.id}/author-public-card.png`

  const desktop = await open(browser, account)
  await expectRoundPhoto(desktop.page, account, key)
  await expect(desktop.page.getByText(bio, { exact: true })).toBeVisible()
  await expect(desktop.page.getByText('author-public-card account bio.')).toHaveCount(0)
  // The card's title, normalised as everywhere public ("Senior Editor" → "Editor").
  await expect(desktop.page.getByText('Editor', { exact: true })).toBeVisible()
  await expect(desktop.page.getByText('0 published articles', { exact: true })).toBeVisible()
  expect(desktop.errors).toEqual([])
  await desktop.ctx.close()

  const phone = await open(browser, account, { width: 390, height: 844 })
  const img = await expectRoundPhoto(phone.page, account, key)
  await expect(img).toBeInViewport()
  await expect(phone.page.getByText(bio, { exact: true })).toBeInViewport()
  expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(phone.errors).toEqual([])
  await phone.ctx.close()
})

test('a hidden team card is never read: account bio and initials, nothing from the card in the page', async ({ browser }) => {
  const hiddenBio = 'Hidden card description that must stay private.'
  const { account } = await author('author-hidden-card', { bio: hiddenBio, isActive: false })

  const { ctx, page, errors } = await open(browser, account)
  await expect(page.getByText('author-hidden-card account bio.', { exact: true })).toBeVisible()
  await expect(page.getByText(initials(account), { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: account.name, exact: true })).toHaveCount(0)
  const html = await page.content()
  expect(html).not.toContain(hiddenBio)
  expect(html).not.toContain('author-hidden-card.png')
  expect(errors).toEqual([])
  await ctx.close()
})
