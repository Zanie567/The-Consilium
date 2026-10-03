import { test, expect, type Page } from '@playwright/test'
import { ArticleEditorPage, articleByTitle, closeDb, db, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'

/**
 * The article list and the trash, as an editor: publish/unpublish from the list, move to
 * trash (with the browser's confirm dialog), see it in Trash, restore it, and delete it
 * for good. At each step the article's public visibility and database state are checked,
 * so a delete can never leave something live and a restore never loses content.
 */
test.describe.configure({ mode: 'serial' })

const TITLE = uniqueTitle('articles')
const BODY = 'Body that must survive the trip through the trash.'
let articleId = ''
let slug = ''

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

const row = (page: Page) => page.locator('tr', { hasText: TITLE })

async function publicStatus(browser: import('@playwright/test').Browser) {
  const anon = await signedIn(browser, null)
  try {
    return (await anon.request.get(`/articles/${slug}`)).status()
  } finally {
    await anon.close()
  }
}

test('an editor creates a draft that appears in the All Articles list with its filters', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  await ed.title().fill(TITLE)
  await ed.typeBody(BODY)
  articleId = (await ed.saveNow()).id
  slug = (await articleByTitle(TITLE))!.slug

  await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^DRAFT\d*$/ }).click()
  // Newest first, so the new draft is on the first page of the Draft filter.
  await expect(row(page)).toBeVisible()
  await page.getByRole('button', { name: /^PUBLISHED\d*$/ }).click()
  await expect(row(page)).toHaveCount(0)
  await ctx.close()
})

test('Publish and Unpublish in the list change what the public can see', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  expect(await publicStatus(browser)).toBe(404)

  const put = page.waitForResponse((r) => r.url().includes(`/api/articles/${articleId}`) && r.request().method() === 'PUT')
  await row(page).getByRole('button', { name: 'Publish', exact: true }).click()
  expect((await put).status()).toBe(200)
  expect((await articleByTitle(TITLE))!.status).toBe('PUBLISHED')
  expect(await publicStatus(browser)).toBe(200)

  const back = page.waitForResponse((r) => r.url().includes(`/api/articles/${articleId}`) && r.request().method() === 'PUT')
  await row(page).getByRole('button', { name: 'Unpublish', exact: true }).click()
  expect((await back).status()).toBe(200)
  expect((await articleByTitle(TITLE))!.status).toBe('DRAFT')
  expect(await publicStatus(browser)).toBe(404)
  await ctx.close()
})

test('Delete asks first; cancelling keeps the article, confirming moves it to Trash', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await page.goto('/editorial/articles', { waitUntil: 'networkidle' })

  let message = ''
  page.once('dialog', (d) => { message = d.message(); void d.dismiss() })
  await row(page).getByRole('button', { name: 'Delete article' }).click()
  await expect.poll(() => message).toMatch(/trash/i)
  expect((await db().article.findUnique({ where: { id: articleId } }))!.deletedAt).toBeNull()
  await expect(row(page)).toBeVisible()

  page.once('dialog', (d) => void d.accept())
  const del = page.waitForResponse((r) => r.url().includes(`/api/articles/${articleId}`) && r.request().method() === 'DELETE')
  await row(page).getByRole('button', { name: 'Delete article' }).click()
  expect((await del).status()).toBe(200)
  await expect(row(page)).toHaveCount(0)
  expect((await db().article.findUnique({ where: { id: articleId } }))!.deletedAt).not.toBeNull()
  expect(await publicStatus(browser)).toBe(404)
  await ctx.close()
})

test('Trash lists it; Restore brings the draft back with its content', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await page.goto('/editorial/trash', { waitUntil: 'networkidle' })
  const item = page.locator('div', { hasText: TITLE }).filter({ has: page.getByRole('button', { name: /restore/i }) }).last()
  await expect(item).toBeVisible()

  const res = page.waitForResponse((r) => r.url().includes(`/api/editorial/trash/${articleId}`) && r.request().method() === 'PATCH')
  await item.getByRole('button', { name: /restore/i }).click()
  expect((await res).status()).toBe(200)
  const restored = await db().article.findUnique({ where: { id: articleId } })
  expect(restored!.deletedAt).toBeNull()
  expect(restored!.content).toContain(BODY)

  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)
  await expect(ed.body()).toContainText(BODY)
  await ctx.close()
})

test('Delete Forever in Trash asks first, then removes the article permanently', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  page.once('dialog', (d) => void d.accept())
  await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
  await row(page).getByRole('button', { name: 'Delete article' }).click()
  await expect.poll(async () => (await db().article.findUnique({ where: { id: articleId } }))?.deletedAt).not.toBeNull()

  await page.goto('/editorial/trash', { waitUntil: 'networkidle' })
  const item = page.locator('div', { hasText: TITLE }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
  await item.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByRole('heading', { name: 'Delete permanently?' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  expect(await db().article.findUnique({ where: { id: articleId } })).not.toBeNull()

  await item.getByRole('button', { name: /^delete$/i }).click()
  const res = page.waitForResponse((r) => r.url().includes(`/api/editorial/trash/${articleId}`) && r.request().method() === 'DELETE')
  await page.getByRole('button', { name: 'Delete Forever' }).click()
  expect((await res).status()).toBe(200)
  expect(await db().article.findUnique({ where: { id: articleId } })).toBeNull()
  await ctx.close()
})
