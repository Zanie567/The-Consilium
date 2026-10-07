import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { ArticleEditorPage, closeDb, db, signedIn } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * A new reader's whole journey through the public site, on a brand-new account created
 * by the sign-up form: sign up, read an article, comment, save it, use the profile tabs,
 * change the display name, sign out and back in, and finally delete the account.
 */
test.describe.configure({ mode: 'serial' })

const stamp = Date.now().toString(36)
const EMAIL = `wf.reader.${stamp}@consilium.test`
const PASSWORD = 'reader-pass-1234'
const NAME = `Reader ${stamp}`
const COMMENT = `A thoughtful comment from ${stamp}.`
const authFile=path.resolve('tests/e2e/.auth',process.env.E2E_RUN_ID!,`reader-${stamp}.json`)
let articlePath = ''

test.afterAll(async () => {
  // The delete-account step normally removes the user; this catches an early failure.
  const user = await db().user.findUnique({ where: { email: EMAIL } })
  if (user) {
    await db().comment.deleteMany({ where: { userId: user.id } })
    await db().bookmark.deleteMany({ where: { userId: user.id } })
    await db().user.delete({ where: { id: user.id } })
  }
  await fs.rm(authFile,{force:true})
  await closeDb()
})

test('sign up through the form lands signed in', async ({ browser }) => {
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  await page.goto('/signup', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()

  const submit = page.locator('button[type="submit"]')
  await page.getByPlaceholder('Your name').fill(NAME)
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('At least 8 characters').fill(PASSWORD)
  await expect(submit, 'terms must be accepted first').toBeDisabled()
  await page.getByRole('checkbox').check()
  const res = page.waitForResponse((r) => r.url().includes('/api/auth/signup') && r.request().method() === 'POST')
  await submit.click()
  expect((await res).status()).toBe(201)
  await page.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 30_000 })

  const user = await db().user.findUnique({ where: { email: EMAIL } })
  expect(user?.role).toBe('READER')
  expect(user?.name).toBe(NAME)
  await expect(page.getByRole('link', { name: 'PROFILE' }).first()).toBeVisible()
  expect(errors, errors.join('\n')).toEqual([])
  await page.context().storageState({ path: authFile })
  await ctx.close()
})

async function readerPage(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext({ storageState: authFile })
  return { ctx, page: await ctx.newPage() }
}

test('the reader comments on an article, and the comment persists', async ({ browser }) => {
  const published = await db().article.findFirst({ where: { status: 'PUBLISHED', deletedAt: null }, orderBy: { publishedAt: 'desc' } })
  articlePath = `/articles/${published!.slug}`
  const { ctx, page } = await readerPage(browser)
  await page.goto(articlePath, { waitUntil: 'networkidle' })

  const box = page.getByPlaceholder('Join the discussion…')
  await box.scrollIntoViewIfNeeded()
  const post = page.getByRole('button', { name: 'Post', exact: true })
  await box.fill('hi')
  await expect(post, 'two letters is too short to post').toBeDisabled()
  await box.fill(COMMENT)
  const res = page.waitForResponse((r) => r.url().includes('/api/comments') && r.request().method() === 'POST')
  await post.click()
  expect((await res).status()).toBe(201)
  await expect(page.getByText(COMMENT)).toBeVisible()

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText(COMMENT)).toBeVisible()
  await ctx.close()
})

test('the reader saves the article and finds it under Saved Articles, then removes it', async ({ browser }) => {
  const { ctx, page } = await readerPage(browser)
  await page.goto(articlePath, { waitUntil: 'networkidle' })
  const save = page.getByRole('button', { name: 'Save article', exact: true }).first()
  const res = page.waitForResponse((r) => r.url().includes('/api/bookmarks') && r.request().method() === 'POST')
  await save.click()
  expect((await res).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Remove bookmark' }).first()).toBeVisible()

  await page.goto('/profile', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'SAVED ARTICLES' }).click()
  await expect(page.getByRole('button', { name: 'Remove bookmark' }).first()).toBeVisible()
  const gone = page.waitForResponse((r) => r.url().includes('/api/profile/saved-articles') && r.request().method() === 'DELETE')
  await page.getByRole('button', { name: 'Remove bookmark' }).first().click()
  expect((await gone).status()).toBe(200)
  await expect(page.getByText('No saved articles yet')).toBeVisible()
  await ctx.close()
})

test('every profile tab opens without errors, and the display name can be changed', async ({ browser }) => {
  const { ctx, page } = await readerPage(browser)
  const errors = collectConsoleErrors(page)
  await page.goto('/profile', { waitUntil: 'networkidle' })
  for (const tab of ['READING HISTORY', 'CURRENTLY READING', 'SAVED ARTICLES', 'DEBATE VOTES', 'MY COMMENTS']) {
    await page.getByRole('button', { name: tab }).click()
    await expect(page.getByRole('button', { name: tab })).toBeVisible()
  }
  await page.getByRole('button', { name: 'MY COMMENTS' }).click()
  await expect(page.getByText(COMMENT)).toBeVisible()

  await page.getByRole('button', { name: 'ACCOUNT SETTINGS' }).click()
  const newName = `${NAME} Jr`
  await page.getByPlaceholder('Your name').fill(newName)
  const res = page.waitForResponse((r) => /\/api\/(profile|users|account)/.test(r.url()) && ['PUT', 'PATCH', 'POST'].includes(r.request().method()))
  await page.getByRole('button', { name: /Save Changes/i }).click()
  expect((await res).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'ACCOUNT SETTINGS' }).click()
  await expect(page.getByPlaceholder('Your name')).toHaveValue(newName)
  expect((await db().user.findUnique({ where: { email: EMAIL } }))?.name).toBe(newName)
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('the reader signs out, then signs back in with the same password', async ({ browser }) => {
  const { ctx, page } = await readerPage(browser)
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'PROFILE' })).toHaveCount(0, { timeout: 15_000 })
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/login/)

  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/\/profile$/)
  await page.context().storageState({ path: authFile })
  await ctx.close()
})

test('the reader deletes their account; they can no longer sign in', async ({ browser }) => {
  const { ctx, page } = await readerPage(browser)
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'ACCOUNT SETTINGS' }).click()
  await page.getByRole('button', { name: /Delete (my )?account|Delete your account/i }).first().click()
  await page.getByPlaceholder(`Type "${EMAIL}" to confirm`).fill(EMAIL)
  const res = page.waitForResponse((r) => r.request().method() === 'DELETE' && /api\//.test(r.url()))
  await page.getByRole('button', { name: /Delete|Confirm/i }).last().click()
  expect((await res).status()).toBe(200)
  expect(await db().user.findUnique({ where: { email: EMAIL } })).toBeNull()
  await ctx.close()

  const anon = await signedIn(browser, null)
  const p = await anon.newPage()
  await p.goto('/login')
  await p.locator('input[type="email"]').fill(EMAIL)
  await p.locator('input[type="password"]').fill(PASSWORD)
  await p.locator('button[type="submit"]').click()
  await expect(p.getByText('Invalid email or password.')).toBeVisible()
  await anon.close()
})
