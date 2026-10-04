import { test, expect, type Page } from '@playwright/test'
import { ArticleEditorPage, articleByTitle, closeDb, removeMyArticles, signedIn, uniqueTitle, confirmPublicChange } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * The same working flow on a phone (Pixel 7 / Chromium and iPhone 14 / WebKit): write,
 * adjust the document settings, submit; review and publish; read the published article.
 * Phone-specific things checked on the way: the controls that move into the settings
 * sheet, the navigation menu, and that no page needs a sideways scroll.
 */
test.describe.configure({ mode: 'serial' })

const TITLE = uniqueTitle('mobile')
let articleId = ''
let slug = ''

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

const noSidewaysScroll = async (page: Page, what: string) => {
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
  expect(m.doc, `${what} scrolls sideways (${m.doc}px content in a ${m.win}px window)`).toBeLessThanOrEqual(m.win + 1)
}

test('a writer writes, sets the document options in the settings sheet, and submits', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  await noSidewaysScroll(page, 'the new-article page')

  await ed.title().fill(TITLE)
  await ed.typeBody('Written on a phone.')
  // There is no Save draft button at phone width: the autosave must carry the work.
  await expect(ed.saveDraftButton()).toBeHidden()
  const res = await ed.saving(async () => { /* autosave fires on its own */ }, { timeout: 15_000 })
  expect(res.status(), await res.text()).toBe(201)
  articleId = ((await res.json()) as { id: string }).id

  // The settings sheet holds category and tags.
  await page.getByRole('button', { name: 'Document settings' }).click()
  const sheet = page.locator('div.fixed', { hasText: 'Document settings' }).filter({ has: page.getByRole('button', { name: 'Close settings' }) })
  await expect(sheet).toBeVisible()
  await sheet.locator('select').first().selectOption({ index: 1 })
  await sheet.getByPlaceholder('Add a tag, press Enter...').fill('mobile')
  await sheet.getByPlaceholder('Add a tag, press Enter...').press('Enter')
  await expect(sheet.getByText('mobile', { exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Close settings' }).click()

  const saved = await ed.saving(async () => {}, { timeout: 15_000 })
  expect(saved.status()).toBe(200)
  const row = await articleByTitle(TITLE)
  slug = row!.slug
  expect(row!.categoryId).not.toBeNull()
  expect(row!.tags.map((t) => t.tag.name)).toEqual(['mobile'])

  const submit = await ed.saving(() => page.getByRole('button', { name: 'Submit' }).click())
  expect(submit.status(), await submit.text()).toBe(200)
  expect((await articleByTitle(TITLE))!.status).toBe('PENDING_REVIEW')
  await noSidewaysScroll(page, 'the editor after submitting')
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('the navigation menu opens and moves around the portal', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  await page.goto('/editorial', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await page.getByRole('link', { name: 'My Articles' }).click()
  await expect(page).toHaveURL(/\/editorial\/articles/)
  await expect(page.getByText(TITLE).first()).toBeVisible()
  await noSidewaysScroll(page, 'My Articles')
  await ctx.close()
})

test('an editor reviews and publishes on a phone', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await page.goto(`/editorial/review/${articleId}`, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
  await noSidewaysScroll(page, 'the review page')
  const res = page.waitForResponse((r) => r.url().includes('/review') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Publish Now' }).click()
  await confirmPublicChange(page, 'Publish now')
  expect((await res).status()).toBe(200)
  expect((await articleByTitle(TITLE))!.status).toBe('PUBLISHED')
  await ctx.close()
})

test('the published article reads properly on a phone', async ({ browser }) => {
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  await page.goto(`/articles/${slug}`, { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText(TITLE)
  await expect(page.locator('.prose-consilium')).toContainText('Written on a phone.')
  await noSidewaysScroll(page, 'the published article')
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('the editor tutorial opens above the toolbar and can be closed on a phone', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  await page.getByRole('button', { name: 'Open editor tutorial' }).click()
  await expect(page.getByRole('heading', { name: 'How to use the article editor' })).toBeVisible()
  await page.getByRole('button', { name: 'Close tutorial' }).click() // fails if the toolbar covers it
  await expect(page.getByRole('heading', { name: 'How to use the article editor' })).toHaveCount(0)
  await ctx.close()
})
