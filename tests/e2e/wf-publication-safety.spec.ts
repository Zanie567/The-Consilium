import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  ArticleEditorPage, articleByTitle, closeDb, confirmDialog, confirmPublicChange, db, removeMyArticles, signedIn, uniqueTitle,
} from './helpers/workflow'

/**
 * Nothing becomes public (or stops being public) except through an explicit publication action
 * that the user confirms. Ordinary autosave, "Save draft", moving the status dropdown, a failed
 * publish followed by more typing, a second tab, and a double click must all leave visibility alone.
 *
 * Two layers are tested: the browser (what a person can trigger) and the API (the server refuses a
 * visibility change that does not carry publicationIntent, whatever the client believes).
 */
const isWrite = (url: string, method: string) => /\/api\/articles\/[^/?]+$/.test(url) && ['PUT', 'PATCH'].includes(method)

async function newDraft(browser: Browser, label: string, who: 'editor' | 'admin' = 'editor') {
  const ctx = await signedIn(browser, who)
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle(label)
  await ed.title().fill(title)
  await ed.typeBody('Draft text.')
  const { id } = await ed.saveNow()
  await page.waitForLoadState('networkidle')
  const slug = (await articleByTitle(title))!.slug
  return { ctx, page, ed, title, id, slug }
}

async function publicStatus(browser: Browser, slug: string) {
  const anon = await signedIn(browser, null)
  try {
    return (await anon.request.get(`/articles/${slug}`)).status()
  } finally {
    await anon.close()
  }
}

const statusSelect = (page: Page) =>
  page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') }).locator('select').first()

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

test.describe('ordinary saves never change visibility', () => {
  test('choosing Published in the status dropdown saves nothing and publishes nothing, even while autosave runs', async ({ browser }) => {
    const { ctx, page, ed, title, slug } = await newDraft(browser, 'dropdown')
    const bodies: string[] = []
    page.on('request', (r) => { if (isWrite(r.url(), r.method())) bodies.push(r.postData() ?? '') })

    await statusSelect(page).selectOption('PUBLISHED')
    // The dropdown only stages the choice: the button now offers Publish, and nothing is sent.
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
    await page.waitForTimeout(3_000)
    expect(bodies, 'staging a status must not save anything').toHaveLength(0)

    // Now an ordinary edit triggers an autosave while "Published" is still staged.
    await ed.moveToEnd()
    const res = await ed.saving(() => page.keyboard.type(' More text.'), { timeout: 15_000 })
    expect(res.status()).toBe(200)
    const sent = JSON.parse(bodies[bodies.length - 1])
    expect(sent.status, 'autosave sends the status the server holds').toBe('DRAFT')
    expect(sent.publicationIntent, 'autosave carries no publication intent').toBeUndefined()

    // Save draft is also an ordinary save.
    await ed.saveNow()
    expect((await articleByTitle(title))!.status).toBe('DRAFT')
    expect(await publicStatus(browser, slug)).toBe(404)
    await ctx.close()
  })

  test('moving a published article to Draft in the dropdown does not unpublish it until the button is confirmed', async ({ browser }) => {
    const { ctx, page, ed, title, id, slug } = await newDraft(browser, 'unpub')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await confirmPublicChange(page, 'Publish now')
    await expect.poll(async () => (await articleByTitle(title))!.status).toBe('PUBLISHED')
    expect(await publicStatus(browser, slug)).toBe(200)

    await statusSelect(page).selectOption('DRAFT')
    await ed.moveToEnd()
    const res = await ed.saving(() => page.keyboard.type(' Edit on a live article.'), { timeout: 15_000 })
    expect(res.status()).toBe(200)
    await ed.saveNow()
    expect((await articleByTitle(title))!.status, 'still published after autosave and Save draft').toBe('PUBLISHED')
    expect(await publicStatus(browser, slug)).toBe(200)

    // The explicit button is "Set to Draft" and asks first.
    await page.getByRole('button', { name: 'Set to Draft' }).click()
    await expect(confirmDialog(page)).toContainText('immediately')
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click()
    expect((await articleByTitle(title))!.status).toBe('PUBLISHED')

    await page.getByRole('button', { name: 'Set to Draft' }).click()
    await confirmPublicChange(page, 'Unpublish')
    await expect.poll(async () => (await articleByTitle(title))!.status).toBe('DRAFT')
    expect(await publicStatus(browser, slug)).toBe(404)
    void id
    await ctx.close()
  })
})

test.describe('publishing is explicit and confirmed', () => {
  test('Cancel and Escape change nothing; Confirm publishes once; the double click is one request', async ({ browser }) => {
    const { ctx, page, title, slug } = await newDraft(browser, 'confirm')
    const publishes: string[] = []
    page.on('request', (r) => { if (isWrite(r.url(), r.method()) && (r.postData() ?? '').includes('"PUBLISHED"')) publishes.push(r.postData()!) })

    const publish = page.getByRole('button', { name: 'Publish', exact: true })
    await publish.click()
    await expect(confirmDialog(page)).toContainText('Publish this article?')
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(confirmDialog(page)).toHaveCount(0)

    await publish.click()
    await page.keyboard.press('Escape')
    await expect(confirmDialog(page)).toHaveCount(0)
    expect(publishes).toHaveLength(0)
    expect((await articleByTitle(title))!.status).toBe('DRAFT')
    expect(await publicStatus(browser, slug)).toBe(404)

    // Focus starts on Cancel, so a stray Enter cannot publish.
    await publish.click()
    await page.keyboard.press('Enter')
    await expect(confirmDialog(page)).toHaveCount(0)
    expect(publishes).toHaveLength(0)

    // Confirm, double-clicked.
    await publish.click()
    await confirmDialog(page).getByRole('button', { name: 'Publish now' }).dblclick()
    await expect.poll(async () => (await articleByTitle(title))!.status).toBe('PUBLISHED')
    await page.waitForTimeout(1_000)
    expect(publishes, 'one publish request however many clicks').toHaveLength(1)
    expect(JSON.parse(publishes[0]).publicationIntent).toBe(true)
    expect(await publicStatus(browser, slug)).toBe(200)
    await ctx.close()
  })

  test('a failed publication reports the failure, leaves the article private, and later edits do not retry it', async ({ browser }) => {
    const { ctx, page, ed, title, slug } = await newDraft(browser, 'failpub')
    let fail = true
    await page.route('**/api/articles/*', (route) =>
      fail && isWrite(route.request().url(), route.request().method())
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue())
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await confirmPublicChange(page, 'Publish now')
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible()
    await expect(confirmDialog(page)).toHaveCount(0)
    expect((await articleByTitle(title))!.status).toBe('DRAFT')

    fail = false
    await ed.moveToEnd()
    const res = await ed.saving(() => page.keyboard.type(' Typed after the failure.'), { timeout: 15_000 })
    expect(res.status()).toBe(200)
    expect((await articleByTitle(title))!.status, 'the failed publish was not retried by autosave').toBe('DRAFT')
    expect(await publicStatus(browser, slug)).toBe(404)
    // The button still offers Publish, because the article is still a draft.
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
    await ctx.close()
  })

  test('text typed while a publish is in flight is saved, and does not undo or repeat the publication', async ({ browser }) => {
    const { ctx, page, ed, title, slug } = await newDraft(browser, 'inflight')
    const writes: { status: string; intent: unknown }[] = []
    page.on('request', (r) => {
      if (isWrite(r.url(), r.method())) { const b = JSON.parse(r.postData() ?? '{}'); writes.push({ status: b.status, intent: b.publicationIntent }) }
    })
    await page.route('**/api/articles/*', async (route) => {
      if (isWrite(route.request().url(), route.request().method()) && (route.request().postData() ?? '').includes('"PUBLISHED"')) {
        await new Promise((r) => setTimeout(r, 2_500))
      }
      return route.continue()
    })
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await confirmPublicChange(page, 'Publish now')
    await ed.moveToEnd()
    await page.keyboard.type(' Typed during the publish.')

    await expect.poll(async () => (await articleByTitle(title))!.content, { timeout: 20_000 }).toContain('Typed during the publish.')
    const row = await articleByTitle(title)
    expect(row!.status).toBe('PUBLISHED')
    expect(await publicStatus(browser, slug)).toBe(200)
    // Exactly one request asked for publication; the follow-up autosave only restated PUBLISHED.
    expect(writes.filter((w) => w.intent === true)).toHaveLength(1)
    expect(writes.filter((w) => w.status !== 'PUBLISHED')).toHaveLength(0)
    await ctx.close()
  })

  test('a stale second tab cannot republish or unpublish: "Keep my version" is an ordinary save', async ({ browser }) => {
    const { ctx, page, title, id, slug } = await newDraft(browser, 'stale')
    const second = await ctx.newPage()
    const ed2 = new ArticleEditorPage(second)
    await ed2.openExisting(id)

    // Tab 1 publishes.
    await page.bringToFront()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await confirmPublicChange(page, 'Publish now')
    await expect.poll(async () => (await articleByTitle(title))!.status).toBe('PUBLISHED')

    // Tab 2 still believes it is a draft. Its edit conflicts; "Keep my version" must not unpublish.
    await second.bringToFront()
    await ed2.moveToEnd()
    await second.keyboard.type(' Stale tab text.')
    await ed2.saving(() => ed2.saveDraftButton().click())
    await expect(second.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(/changed/i)
    const keep = await ed2.saving(() => second.getByRole('button', { name: 'Keep my version' }).click())
    expect(keep.status()).toBe(200)
    const keptBody = keep.request().postDataJSON()
    expect(keptBody.status).toBe('PUBLISHED')
    expect(keptBody.publicationIntent).not.toBe(true)
    expect(keptBody.expectedUpdatedAt).toBeTruthy()
    expect(keptBody.baseVersion).toMatch(/^[a-f0-9]{24}$/)
    const kept = (await articleByTitle(title))!
    expect(kept.status).toBe('PUBLISHED')
    expect(kept.content).toContain('Stale tab text.')
    expect(await publicStatus(browser, slug)).toBe(200)
    await ctx.close()
  })
})

test.describe('the article list asks before it publishes', () => {
  test('Cancel changes nothing; Confirm publishes once even when double-clicked; Unpublish asks too', async ({ browser }) => {
    const { ctx, page, title, id, slug } = await newDraft(browser, 'listpub')
    const writes: string[] = []
    await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    page.on('request', (r) => { if (isWrite(r.url(), r.method())) writes.push(r.postData() ?? '') })
    const row = page.locator('tr', { hasText: title })

    await row.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(confirmDialog(page)).toContainText(title)
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click()
    expect(writes).toHaveLength(0)
    expect((await db().article.findUnique({ where: { id } }))!.status).toBe('DRAFT')

    await row.getByRole('button', { name: 'Publish', exact: true }).click()
    await confirmDialog(page).getByRole('button', { name: 'Publish now' }).dblclick()
    await expect.poll(async () => (await db().article.findUnique({ where: { id } }))!.status).toBe('PUBLISHED')
    await page.waitForTimeout(800)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toMatchObject({ status: 'PUBLISHED', publicationIntent: true })
    expect(await publicStatus(browser, slug)).toBe(200)

    await row.getByRole('button', { name: 'Unpublish', exact: true }).click()
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click()
    expect((await db().article.findUnique({ where: { id } }))!.status).toBe('PUBLISHED')
    await row.getByRole('button', { name: 'Unpublish', exact: true }).click()
    await confirmPublicChange(page, 'Unpublish')
    await expect.poll(async () => (await db().article.findUnique({ where: { id } }))!.status).toBe('DRAFT')
    expect(await publicStatus(browser, slug)).toBe(404)
    await ctx.close()
  })
})

test.describe('the review screen asks before it publishes', () => {
  test('Publish Now needs confirmation; Cancel leaves the article pending', async ({ browser }) => {
    const writer = await signedIn(browser, 'writer')
    const wp = await writer.newPage()
    const wed = new ArticleEditorPage(wp)
    await wed.openNew()
    const title = uniqueTitle('review')
    await wed.title().fill(title)
    await wed.typeBody('For review.')
    const { id } = await wed.saveNow()
    await wed.saving(() => wp.getByRole('button', { name: 'Submit' }).click())
    await writer.close()

    const editor = await signedIn(browser, 'editor')
    const page = await editor.newPage()
    await page.goto(`/editorial/review/${id}`, { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    await page.getByRole('button', { name: 'Publish Now' }).click()
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click()
    expect((await db().article.findUnique({ where: { id } }))!.status).toBe('PENDING_REVIEW')

    await page.getByRole('button', { name: 'Publish Now' }).click()
    await confirmPublicChange(page, 'Publish now')
    await expect.poll(async () => (await db().article.findUnique({ where: { id } }))!.status).toBe('PUBLISHED')
    await editor.close()
  })
})

test.describe('the server refuses unconfirmed visibility changes (API layer)', () => {
  test('PUT without publicationIntent is refused for every public-facing transition and changes nothing', async ({ browser }) => {
    const { ctx, title, id } = await newDraft(browser, 'api')
    const put = (data: Record<string, unknown>) => ctx.request.put(`/api/articles/${id}`, { data: { title, ...data } })

    for (const status of ['PUBLISHED', 'SCHEDULED']) {
      const res = await put({ status, scheduledAt: new Date(Date.now() + 864e5 * 30).toISOString().slice(0, 16) })
      expect(res.status(), `${status} without intent`).toBe(409)
      expect((await res.json()).code).toBe('PUBLICATION_CONFIRMATION_REQUIRED')
    }
    expect((await db().article.findUnique({ where: { id } }))!.status).toBe('DRAFT')

    // Restating the current status is an ordinary save and needs no intent.
    expect((await put({ status: 'DRAFT' })).status()).toBe(200)

    // With intent it works; then taking it down without intent is refused too.
    expect((await put({ status: 'PUBLISHED', publicationIntent: true })).status()).toBe(200)
    const down = await put({ status: 'DRAFT' })
    expect(down.status()).toBe(409)
    expect((await db().article.findUnique({ where: { id } }))!.status).toBe('PUBLISHED')
    expect((await put({ status: 'ARCHIVED' })).status(), 'archiving a live article also unpublishes it').toBe(409)
    await ctx.close()
  })

  test('a writer cannot publish even with the intent flag', async ({ browser }) => {
    const ctx = await signedIn(browser, 'writer')
    const page = await ctx.newPage()
    const ed = new ArticleEditorPage(page)
    await ed.openNew()
    const title = uniqueTitle('writerapi')
    await ed.title().fill(title)
    const { id } = await ed.saveNow()
    const res = await ctx.request.put(`/api/articles/${id}`, { data: { title, status: 'PUBLISHED', publicationIntent: true } })
    expect(res.status()).toBe(200) // the status field is ignored for writers…
    expect((await res.json()).status).toBe('DRAFT') // …so it stays a draft
    expect((await db().article.findUnique({ where: { id } }))!.status).toBe('DRAFT')
    await ctx.close()
  })
})
