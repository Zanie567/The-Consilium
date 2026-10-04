import { test, expect, type Page } from '@playwright/test'
import {
  ArticleEditorPage, articleByTitle, capturedEmails, closeDb, db, removeMyArticles, signedIn, uniqueTitle,
} from './helpers/workflow'

/**
 * The whole publication workflow, one person per browser session: a writer creates,
 * saves and submits; an editor reviews, returns with feedback, approves, schedules,
 * publishes and unpublishes. Every step is a click or keystroke in the UI. At each
 * stage the same facts are checked: what the state is in the database, who can reach
 * what, and whether an anonymous visitor can see the article.
 *
 * Reading the database and calling the cron endpoint are fixtures for the things no
 * person does (the scheduler firing); they never stand in for a user action.
 */
test.describe.configure({ mode: 'serial' })

const TITLE = uniqueTitle('lifecycle')
const BODY = 'First version of the body text.'
const REVISED = ' Revised with a cited source.'
const FEEDBACK = 'Please add a source for the headline claim.'
const CRON_SECRET = 'local_e2e_cron_secret'

let articleId = ''
let slug = ''

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

async function publicStatus(browser: import('@playwright/test').Browser) {
  const anon = await signedIn(browser, null)
  try {
    const res = await anon.request.get(`/articles/${slug}`)
    const list = await anon.request.get('/api/articles')
    expect(list.status(), 'public listing must succeed before checking absence').toBe(200)
    const listed = (await list.text()).includes(TITLE)
    return { page: res.status(), listed }
  } finally {
    await anon.close()
  }
}

const emailsFor = (to: string, needle: string) =>
  capturedEmails().filter((m) => m.to === to && m.subject.includes(needle))

test('writer creates and saves a draft; it is private and listed under My Drafts', async ({ browser }, testInfo) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  await ed.title().fill(TITLE)
  await ed.typeBody(BODY)
  await page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') }).locator('select').first().selectOption({ index: 1 })

  const saved = await ed.saveNow()
  articleId = saved.id
  expect(saved.status).toBe(201)

  const row = await articleByTitle(TITLE)
  slug = row!.slug
  expect(row!.status).toBe('DRAFT')
  expect(row!.content).toContain(BODY)
  await page.screenshot({ path: testInfo.outputPath('writer-saved-draft.png'), fullPage: true })

  // It shows up in the writer's own draft list, found by clicking the sidebar link.
  await page.getByRole('link', { name: 'My Drafts' }).click()
  await expect(page.getByText(TITLE).first()).toBeVisible()

  expect(await publicStatus(browser)).toEqual({ page: 404, listed: false })
  await ctx.close()
})

test('permissions on a draft: the editor can open it, other roles cannot', async ({ browser }) => {
  // The reader cannot enter the portal at all.
  const reader = await signedIn(browser, 'reader')
  const rp = await reader.newPage()
  await rp.goto(`/editorial/articles/${articleId}/edit`)
  await expect(rp.getByText('Access Denied')).toBeVisible()
  await reader.close()

  // Growth is bounced to the dashboard.
  const growth = await signedIn(browser, 'growth')
  const gp = await growth.newPage()
  await gp.goto(`/editorial/articles/${articleId}/edit`)
  await expect(gp).toHaveURL(/\/editorial$/)
  await growth.close()

  // A writer cannot use the review screen.
  const writer = await signedIn(browser, 'writer')
  const wp = await writer.newPage()
  await wp.goto(`/editorial/review/${articleId}`)
  await expect(wp).toHaveURL(/\/editorial$/)
  await writer.close()

  // An editor opens the draft in the editor.
  const editor = await signedIn(browser, 'editor')
  const ep = await editor.newPage()
  await new ArticleEditorPage(ep).openExisting(articleId)
  await expect(ep.getByPlaceholder('Your headline here...')).toHaveValue(TITLE)
  await editor.close()
})

test('writer submits; the editor is notified and finds it in the review queue', async ({ browser }, testInfo) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)
  const res = await ed.saving(() => page.getByRole('button', { name: 'Submit' }).click())
  expect(res.status(), await res.text()).toBe(200)
  expect((await articleByTitle(TITLE))!.status).toBe('PENDING_REVIEW')
  await ctx.close()

  await expect.poll(() => emailsFor('editor.global@consilium.test', TITLE).length, { message: 'submission email to the editor (captured, not sent)' }).toBeGreaterThan(0)
  expect(await publicStatus(browser)).toEqual({ page: 404, listed: false })

  const editor = await signedIn(browser, 'editor')
  const ep = await editor.newPage()
  await ep.goto('/editorial/review', { waitUntil: 'networkidle' })
  await ep.getByRole('link', { name: TITLE }).first().click()
  await expect(ep).toHaveURL(new RegExp(`/editorial/review/${articleId}$`))
  await expect(ep.getByRole('heading', { name: TITLE })).toBeVisible()
  await ep.screenshot({ path: testInfo.outputPath('editor-submitted-review.png'), fullPage: true })
  await editor.close()
})

test('editor adds an internal note and returns the article with feedback', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await page.goto(`/editorial/review/${articleId}`, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()

  // Exercise the implemented anchored thread controls in the real review UI.
  await new ArticleEditorPage(page).select(BODY)
  await page.getByRole('button', { name: 'Add comment', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeDisabled()
  await page.getByPlaceholder('Add a comment...').fill('Please verify this sentence against the source.')
  const commentResponse = page.waitForResponse(r => r.url().endsWith(`/articles/${articleId}/comments`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Add comment', exact: true }).click()
  expect((await commentResponse).status()).toBe(201)
  await expect(page.getByText('Please verify this sentence against the source.')).toBeVisible()
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByPlaceholder('Reply...', { exact: true }).fill('Source comparison recorded.')
  const replyResponse = page.waitForResponse(r => r.url().endsWith(`/articles/${articleId}/comments`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  expect((await replyResponse).status()).toBe(201)
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await page.getByRole('button', { name: 'Show 1 resolved' }).click()
  await page.getByRole('button', { name: 'Reopen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Comments', exact: false }).click()
  await expect(page.getByText('Source comparison recorded.')).toBeVisible()
  const threads = await db().articleComment.findMany({ where: { articleId } })
  expect(threads).toHaveLength(2)
  expect(threads.find(t => !t.parentId)).toMatchObject({ quotedText: BODY, resolved: false })
  await page.getByRole('button', { name: 'Review', exact: true }).click()

  await page.getByPlaceholder('Add internal note...').fill('Check the headline claim.')
  const noteRes = page.waitForResponse((r) => r.url().includes(`/api/articles/${articleId}/notes`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  expect((await noteRes).status()).toBe(201)
  await expect(page.getByText('Check the headline claim.')).toBeVisible()

  const ret = page.getByRole('button', { name: 'Return to Writer' })
  await expect(ret).toBeDisabled() // no feedback typed yet: cannot return blank
  await page.getByPlaceholder('What needs to be revised?').fill(FEEDBACK)
  const res = page.waitForResponse((r) => r.url().includes(`/review`) && r.request().method() === 'PATCH')
  await ret.click()
  const r = await res
  expect(r.status(), await r.text()).toBe(200)
  const row = await articleByTitle(TITLE)
  expect(row!.status).toBe('REJECTED')
  expect(row!.editorNote).toBe(FEEDBACK)
  await ctx.close()

  await expect.poll(() => emailsFor('writer@theconsilium.com', 'returned').length).toBeGreaterThan(0)
  expect(emailsFor('writer@theconsilium.com', 'returned')[0].html).toContain(FEEDBACK)
  expect(await publicStatus(browser)).toEqual({ page: 404, listed: false })
})

test('writer sees the feedback, revises in the editor, and resubmits; the note clears', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)
  await expect(page.getByText('Editor feedback')).toBeVisible()
  await expect(page.getByText(FEEDBACK)).toBeVisible()
  await expect(ed.title()).toBeEnabled() // returned articles are editable again

  await ed.moveToEnd()
  const saved = await ed.saving(() => page.keyboard.type(REVISED), { timeout: 15_000 }) // autosave
  expect(saved.status()).toBe(200)

  const res = await ed.saving(() => page.getByRole('button', { name: 'Submit' }).click())
  expect(res.status(), await res.text()).toBe(200)
  const row = await articleByTitle(TITLE)
  expect(row!.status).toBe('PENDING_REVIEW')
  expect(row!.editorNote).toBeNull()
  expect(row!.content).toContain('Revised with a cited source.')
  await ctx.close()
})

async function openReview(page: Page) {
  await page.goto(`/editorial/review/${articleId}`, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
}

test('editor schedules it for a future time; still private, then the scheduler publishes it', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await openReview(page)
  const res = page.waitForResponse((r) => r.url().includes('/review') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  const r = await res
  expect(r.status(), await r.text()).toBe(200)
  const row = await articleByTitle(TITLE)
  expect(row!.status).toBe('SCHEDULED')
  expect(row!.scheduledAt!.getTime()).toBeGreaterThan(Date.now())
  await ctx.close()

  expect(await publicStatus(browser), 'scheduled in the future is not public').toEqual({ page: 404, listed: false })

  // The scheduler fires (not a user action): make it due, then call the cron endpoint.
  await db().article.update({ where: { id: articleId }, data: { scheduledAt: new Date(Date.now() - 60_000) } })
  const anon = await signedIn(browser, null)
  const cron = await anon.request.post('/api/publish-scheduled', { headers: { 'x-cron-secret': CRON_SECRET } })
  expect(cron.status(), await cron.text()).toBe(200)
  await anon.close()

  expect((await articleByTitle(TITLE))!.status).toBe('PUBLISHED')
  await expect.poll(() => emailsFor('writer@theconsilium.com', 'live').length).toBeGreaterThan(0)
  expect(await publicStatus(browser)).toEqual({ page: 200, listed: true })
})

test('editor unpublishes from the review screen; the public URL disappears; republish via Publish Now', async ({ browser }, testInfo) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await openReview(page)
  await expect(page.getByText('Published Actions')).toBeVisible()
  const res = page.waitForResponse((r) => r.url().includes('/review') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Unpublish' }).click()
  expect((await res).status()).toBe(200)
  const row = await articleByTitle(TITLE)
  expect(row!.status).toBe('DRAFT')
  expect(row!.publishedAt).toBeNull()
  await ctx.close()
  expect(await publicStatus(browser)).toEqual({ page: 404, listed: false })

  // The author can resubmit, and an editor can approve it straight to live.
  const w = await signedIn(browser, 'writer')
  const wp = await w.newPage()
  const ed = new ArticleEditorPage(wp)
  await ed.openExisting(articleId)
  expect((await ed.saving(() => wp.getByRole('button', { name: 'Submit' }).click())).status()).toBe(200)
  await w.close()

  const e2 = await signedIn(browser, 'editor')
  const p2 = await e2.newPage()
  await openReview(p2)
  const pub = p2.waitForResponse((r) => r.url().includes('/review') && r.request().method() === 'PATCH')
  await p2.getByRole('button', { name: 'Publish Now' }).click()
  expect((await pub).status()).toBe(200)
  await e2.close()
  expect(await publicStatus(browser)).toEqual({ page: 200, listed: true })

  const anon = await signedIn(browser, null)
  const page2 = await anon.newPage()
  await page2.goto(`/articles/${slug}`)
  await expect(page2.locator('h1')).toContainText(TITLE)
  await expect(page2.locator('.prose-consilium')).toContainText('Revised with a cited source.')
  await page2.screenshot({ path: testInfo.outputPath('public-revised-article.png'), fullPage: true })
  await anon.close()
})

test('a published article is locked for its writer, with an accurate explanation', async ({ browser }) => {
  const w = await signedIn(browser, 'writer')
  const wp = await w.newPage()
  await wp.goto(`/editorial/articles/${articleId}/edit`, { waitUntil: 'networkidle' })
  await expect(wp.getByText(/no longer a draft/)).toBeVisible()
  await expect(wp.getByText(/under review/)).toHaveCount(0)
  await expect(wp.getByPlaceholder('Your headline here...')).toBeDisabled()
  await w.close()
})
