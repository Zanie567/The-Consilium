import { test, expect } from '@playwright/test'
import { ArticleEditorPage, closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signInAs, signedIn, uniqueTitle, withCookieConsentAnswered, type TestAccount } from './helpers/workflow'

/**
 * The tag taxonomy end to end: writers choose approved tags and suggest new ones (they cannot create
 * them, through the UI or the API); a tag manager reviews suggestions and merges duplicates in
 * /editorial/tags; a merged tag's public address redirects and its archive filter keeps working; a
 * merge can be undone.
 */
test.describe.configure({ mode: 'serial' })

const KEY = uniqueTitle('tags').replace(/^WF /, 'WF-')
const N = (label: string) => `${KEY} ${label}`
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const SOURCE = N('Labour Market')
const TARGET = N('Labour Markets')
const SUGGESTED = N('Gig Economy')
let writer: TestAccount
let articleId = ''

test.beforeAll(async () => {
  writer = await createAccount('WRITER', 'tags')
  for (const name of [SOURCE, TARGET]) await db().tag.create({ data: { name, slug: slug(name) } })
})

test.afterAll(async () => {
  await removeMyArticles()
  await db().articleTag.deleteMany({ where: { articleId } })
  await db().tagSuggestion.deleteMany({ where: { name: { startsWith: KEY } } })
  const tags = await db().tag.findMany({ where: { name: { startsWith: KEY } }, select: { id: true } })
  await db().tag.updateMany({ where: { id: { in: tags.map((t) => t.id) } }, data: { mergedIntoId: null } })
  await db().articleTag.deleteMany({ where: { tagId: { in: tags.map((t) => t.id) } } })
  await db().tag.deleteMany({ where: { id: { in: tags.map((t) => t.id) } } })
  await removeMyAccounts()
  await closeDb()
})

test('a writer cannot manage tags or create one by saving, through the UI or the API', async ({ browser }) => {
  const ctx = await signInAs(browser, writer)
  expect((await ctx.request.post('/api/editorial/tags', { data: { name: N('Sneaky') } })).status()).toBe(403)
  const tag = await db().tag.findFirstOrThrow({ where: { name: SOURCE } })
  expect((await ctx.request.patch(`/api/editorial/tags/${tag.id}`, { data: { retired: true } })).status()).toBe(403)
  expect((await ctx.request.post(`/api/editorial/tags/${tag.id}/merge`, { data: { into: tag.id } })).status()).toBe(403)
  const created = await ctx.request.post('/api/articles', { data: { title: uniqueTitle('tags api'), content: '<p>x</p>', tags: [N('Not Approved')] } })
  expect(created.status()).toBe(400)
  expect((await created.json()).code).toBe('TAG_NOT_APPROVED')
  expect(await db().tag.count({ where: { name: N('Not Approved') } })).toBe(0)
  // The page itself is not offered: the portal sends the writer back to the dashboard.
  const page = await ctx.newPage()
  await page.goto('/editorial/tags')
  await expect(page).toHaveURL(/\/editorial$/)
  await expect(page.getByRole('link', { name: 'Tags', exact: true })).toHaveCount(0)
  await ctx.close()
})

test('a writer picks an approved tag by searching and suggests a new one for review', async ({ browser }) => {
  const ctx = await withCookieConsentAnswered(await signInAs(browser, writer))
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  await ed.title().fill(uniqueTitle('tags editor'))
  await ed.typeBody('Tag selector body.')
  // Saved first, so the suggestion below can be linked to this article (an unsaved article has no id).
  articleId = (await ed.saveNow()).id
  const box = page.locator('aside').getByRole('combobox', { name: 'Article topics' })
  await box.fill(`${KEY} labour markets`)
  await box.press('Enter')
  const chosen = page.locator('aside').getByRole('list', { name: 'Chosen tags' })
  await expect(chosen.getByText(TARGET, { exact: true })).toBeVisible()

  // A wording that does not exist yet can only be suggested; it is not added to the article.
  await box.fill(SUGGESTED)
  const suggest = page.getByRole('option', { name: `Suggest “${SUGGESTED}” for review` })
  await expect(suggest).toBeVisible()
  await suggest.click()
  await expect(page.locator('aside').getByRole('status').filter({ hasText: 'Suggested' })).toContainText('not on the article yet')
  await expect(chosen.getByText(SUGGESTED)).toHaveCount(0)

  await ed.saveNow()
  const saved = await db().article.findUniqueOrThrow({ where: { id: articleId }, include: { tags: { include: { tag: true } } } })
  expect(saved.tags.map((t) => t.tag.name)).toEqual([TARGET])
  const suggestion = await db().tagSuggestion.findFirstOrThrow({ where: { name: SUGGESTED } })
  expect(suggestion).toMatchObject({ status: 'PENDING', suggestedById: writer.id, articleId })
  await ctx.close()
})

test('a tag manager approves the suggestion and the writer is told', async ({ browser }) => {
  const ctx = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await ctx.newPage()
  await page.goto('/editorial/tags', { waitUntil: 'networkidle' })
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Suggested by writers' }) })
  const row = panel.getByRole('listitem').filter({ hasText: SUGGESTED })
  await row.getByRole('button', { name: 'Approve…' }).click()
  const dialog = page.getByRole('dialog', { name: `Approve “${SUGGESTED}”` })
  await dialog.getByRole('button', { name: 'Create tag' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Approved' })).toBeVisible()
  await expect(row).toHaveCount(0)
  expect(await db().tag.count({ where: { name: SUGGESTED } })).toBe(1)
  expect(await db().notification.count({ where: { userId: writer.id, type: 'tag_suggestion' } })).toBe(1)
  await ctx.close()
})

test('merging redirects the old tag page, keeps archive links working, and can be undone', async ({ browser }) => {
  // The article now carries TARGET; give the source an article of its own.
  const source = await db().tag.findFirstOrThrow({ where: { name: SOURCE } })
  const target = await db().tag.findFirstOrThrow({ where: { name: TARGET } })
  const own = await db().article.create({ data: { title: uniqueTitle('tags merge'), slug: `${slug(KEY)}-merge`, content: '<p>m</p>', authorId: writer.id, status: 'PUBLISHED', publishedAt: new Date(), tags: { create: [{ tagId: source.id }] } } })

  const ctx = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await ctx.newPage()
  await page.goto('/editorial/tags', { waitUntil: 'networkidle' })
  await page.getByRole('searchbox', { name: 'Search tags and aliases' }).fill(KEY)
  await page.getByRole('button', { name: `Merge ${SOURCE} into another tag` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Search tags').fill(TARGET)
  await dialog.getByRole('listbox', { name: 'Tag to merge into' }).selectOption({ label: `${TARGET} (1)` })
  await expect(dialog).toContainText('1 article moves')
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Merged' })).toBeVisible()
  expect((await db().articleTag.findMany({ where: { articleId: own.id } })).map((t) => t.tagId)).toEqual([target.id])

  const anon = await signedIn(browser, null)
  const old = await anon.request.get(`/tag/${source.slug}`, { maxRedirects: 0 })
  expect([307, 308]).toContain(old.status())
  expect(old.headers().location).toContain(`/tag/${target.slug}`)
  const reader = await anon.newPage()
  await reader.goto(`/archive?tag=${source.slug}`)
  await expect(reader.getByRole('heading', { name: own.title, exact: true })).toBeVisible()
  await anon.close()

  await page.getByRole('button', { name: /^Merged/ }).click()
  await page.getByRole('listitem').filter({ hasText: SOURCE }).getByRole('button', { name: 'Undo merge' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Merge undone' })).toBeVisible()
  expect((await db().articleTag.findMany({ where: { articleId: own.id } })).map((t) => t.tagId)).toEqual([source.id])
  expect((await db().tag.findUniqueOrThrow({ where: { id: source.id } })).mergedIntoId).toBeNull()
  await db().articleTag.deleteMany({ where: { articleId: own.id } })
  await db().article.delete({ where: { id: own.id } })
  await ctx.close()
})

for (const width of [375, 768, 1440]) {
  test(`the tag dashboard fits a ${width}px screen`, async ({ browser }) => {
    const ctx = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
    const page = await ctx.newPage()
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/editorial/tags', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Tags' })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search tags and aliases' }).fill(KEY)
    const row = page.getByRole('list', { name: 'Tags' }).getByRole('listitem').filter({ hasText: TARGET })
    const rename = (await row.getByRole('button', { name: `Rename ${TARGET}` }).boundingBox())!
    expect(rename.x + rename.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await ctx.close()
  })
}
