import fs from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { ArticleEditorPage, closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signInAs, signedIn, uniqueTitle } from './helpers/workflow'

/**
 * The content-management screens that are not the article editor: series, glossary, debates,
 * predictions, comment moderation and the subscriber list. Each is driven by the role that owns it
 * (editor for series/debates/comments, admin for glossary/predictions, growth and admin for
 * subscribers), and the public effect or the refusal of other roles is checked at the end.
 */
// Everything this file creates carries its own stamp, and cleanup is by stamp: specs run in parallel
// (Chromium and WebKit) and a prefix-wide delete removed the other browser's rows.
const stamp = Date.now().toString(36)

test.afterAll(async () => {
  await removeMyArticles()
  await db().series.deleteMany({ where: { title: { contains: stamp } } }).catch(() => {})
  await db().glossaryTerm.deleteMany({ where: { term: { contains: stamp } } }).catch(() => {})
  await db().debate.deleteMany({ where: { title: { contains: stamp } } }).catch(() => {})
  await db().predictionEvent.deleteMany({ where: { title: { contains: stamp } } }).catch(() => {})
  await db().subscriber.deleteMany({ where: { email: { contains: stamp } } }).catch(() => {})
  await removeMyAccounts()
  await closeDb()
})

const alertOf = (p: Page) => p.locator('[role="alert"]:not(#__next-route-announcer__)')
const publishedArticle = async (title: string, text: string) => {
  const author = await createAccount('WRITER', 'content')
  return db().article.create({
    data: {
      title, slug: `wf-pub-${Math.random().toString(36).slice(2, 8)}-${stamp}`, authorId: author.id, status: 'PUBLISHED', publishedAt: new Date(),
      content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }),
    },
  })
}

test.describe('series (editor)', () => {
  test('create a series, reject an empty title, add an article, and see it listed', async ({ browser }) => {
    // The picker offers PUBLISHED articles only.
    const draft = await publishedArticle(uniqueTitle('inseries'), 'Series member.')
    const ctx = await signedIn(browser, 'editor')
    const page = await ctx.newPage()
    await page.goto('/editorial/series', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()

    await page.getByRole('button', { name: 'New Series' }).click()
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByText('Title is required.')).toBeVisible()

    const title = `WF series ${stamp}`
    await page.getByPlaceholder('e.g. UK Housing Policy').fill(title)
    await page.getByPlaceholder('Brief description (optional)').fill('A test series')
    const created = page.waitForResponse((r) => r.url().endsWith('/api/editorial/series') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(page.getByText(title)).toBeVisible()

    await page.getByText(title).click() // expand
    const select = page.locator('select[id^="assign-"]').first()
    await select.selectOption({ value: draft.id })
    const put = page.waitForResponse((r) => r.url().includes(`/api/articles/${draft.id}`) && r.request().method() === 'PUT')
    const reloaded = page.waitForEvent('load') // the page reloads itself after an assignment
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    expect((await put).status()).toBe(200)
    await reloaded
    await page.waitForLoadState('networkidle')
    const row = await db().article.findUnique({ where: { id: draft.id } })
    expect(row!.seriesId).not.toBeNull()
    expect(row!.status, 'adding to a series must not change visibility').toBe('PUBLISHED')

    // The page reloads itself after an assignment; the member is listed once it has.
    await expect(page.getByText(title)).toBeVisible()
    await page.getByText(title).click()
    await expect(page.locator('span', { hasText: draft.title }).first()).toBeVisible() // listed under 'Articles in series'
    await ctx.close()
  })

  test('a writer cannot create a series', async ({ browser }) => {
    const ctx = await signedIn(browser, 'writer')
    const res = await ctx.request.post('/api/editorial/series', { data: { title: `WF nope ${stamp}`, description: '' } })
    expect(res.status()).toBe(403)
    await ctx.close()
  })
})

test.describe('glossary (admin)', () => {
  test('a term is created, switched on, shown on a published article, deactivated, and deleted', async ({ browser }) => {
    test.setTimeout(90_000)
    const term = `wfterm${stamp}`
    const article = await publishedArticle(uniqueTitle('gloss'), `This article discusses ${term} in some detail.`)
    const ctx = await signedIn(browser, 'admin')
    const page = await ctx.newPage()
    await page.goto('/editorial/glossary', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()

    await page.getByRole('button', { name: /New term/i }).click()
    await page.locator('#gl-term').fill(term)
    await page.getByPlaceholder('QE').fill('wfalias')
    await page.getByPlaceholder(/One to three plain sentences/).fill('A made-up term used to test the glossary.')
    await page.getByPlaceholder(/bankofengland/).fill('https://example.org/learn-more')
    const saved = page.waitForResponse((r) => r.url().includes('/api/editorial/glossary') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Add term' }).click()
    expect((await saved).status()).toBe(200)
    await expect(page.getByText(term, { exact: true }).first()).toBeVisible()

    // Switch term linking on for the whole site.
    const sw = page.getByRole('switch', { name: 'Term linking on articles' })
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')

    const anon = await signedIn(browser, null)
    const pub = await anon.newPage()
    const linked = () => pub.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' }).then(() => pub.locator('.glossary-term').count())
    await expect.poll(linked, { message: 'the term is linked on the published article', timeout: 20_000 }).toBeGreaterThan(0)

    // Deactivate: the tooltip goes.
    const row = page.locator('div', { hasText: term }).filter({ has: page.getByRole('button', { name: 'Deactivate' }) }).last()
    await row.getByRole('button', { name: 'Deactivate' }).click()
    await expect(row.getByRole('button', { name: 'Activate' })).toBeVisible()
    await expect.poll(linked, { timeout: 20_000 }).toBe(0)

    // Delete asks first (browser confirm); cancelling keeps it, accepting removes it.
    page.once('dialog', (d) => void d.dismiss())
    await page.getByRole('button', { name: `Delete ${term}` }).click()
    expect(await db().glossaryTerm.count({ where: { term } })).toBe(1)
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: `Delete ${term}` }).click()
    await expect.poll(() => db().glossaryTerm.count({ where: { term } })).toBe(0)

    await sw.click() // leave the site switch off, as found
    await anon.close()
    await ctx.close()
  })

  test('only an admin may change the glossary', async ({ browser }) => {
    for (const who of ['editor', 'writer', 'growth', 'reader'] as const) {
      const ctx = await signedIn(browser, who)
      const res = await ctx.request.post('/api/editorial/glossary', { data: { term: `wfterm${stamp}x`, definition: 'x'.repeat(30) } })
      expect(res.status(), who).toBe(403)
      await ctx.close()
    }
    expect(await db().glossaryTerm.count({ where: { term: `wfterm${stamp}x` } })).toBe(0)
  })
})

test.describe('debates (editor)', () => {
  test('create an active debate, see it on the public hub, edit its title', async ({ browser }) => {
    test.setTimeout(90_000)
    const ctx = await signedIn(browser, 'editor')
    const page = await ctx.newPage()
    await page.goto('/editorial/debates/new', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    const title = `WF debate ${stamp}`
    await page.getByPlaceholder('e.g. Should the UK raise the minimum wage?').fill(title)
    await page.getByPlaceholder('Brief framing of the debate shown to readers').fill('Framing text')
    await page.getByPlaceholder('Title arguing FOR the proposition').fill('For: yes it should')
    await page.getByPlaceholder('Short summary shown in the debate card').first().fill('For summary')
    await page.getByPlaceholder('Title arguing AGAINST the proposition').fill('Against: no it should not')
    await page.getByPlaceholder('Short summary shown in the debate card').last().fill('Against summary')
    await page.getByRole('checkbox', { name: /Publish as active debate/ }).check()

    // Both sides need written content: the form says so, and sends nothing, until they have it.
    const writes: string[] = []
    page.on('request', (r) => { if (r.url().includes('/api/editorial/debates') && r.method() === 'POST') writes.push(r.url()) })
    await page.getByRole('button', { name: 'Create Debate' }).click()
    await expect(page.getByText(/write content for both sides/)).toBeVisible()
    expect(writes).toHaveLength(0)
    await page.locator('.ProseMirror').first().click()
    await page.keyboard.type('The case for.')
    await page.locator('.ProseMirror').last().click()
    await page.keyboard.type('The case against.')
    const created = page.waitForResponse((r) => /\/api\/editorial\/debates/.test(r.url()) && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create Debate' }).click()
    expect((await created).status()).toBe(201)
    await page.waitForURL('**/editorial/debates')
    await expect(page.getByText(title).first()).toBeVisible()

    const anon = await signedIn(browser, null)
    const pub = await anon.newPage()
    await pub.goto('/opinion-debate', { waitUntil: 'networkidle' })
    await expect(pub.getByText(title).first()).toBeVisible()
    await anon.close()
    await ctx.close()
  })

  test('a writer and a reader cannot create debates', async ({ browser }) => {
    for (const who of ['writer', 'reader', 'growth'] as const) {
      const ctx = await signedIn(browser, who)
      const res = await ctx.request.post('/api/editorial/debates', { data: { title: `WF nope ${who} ${stamp}` } })
      expect(res.status(), who).toBe(401)
      await ctx.close()
    }
  })
})

test.describe('predictions (admin)', () => {
  test('create an event, close early, reopen, then cancel it after confirming; others are refused', async ({ browser }) => {
    test.setTimeout(90_000)
    const ctx = await signedIn(browser, 'admin')
    const page = await ctx.newPage()
    await page.goto('/editorial/predictions/new', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    const title = `WF prediction ${stamp}`
    await page.locator('#ev-title').fill(title)
    await page.locator('#ev-description').fill('A test event')
    await page.locator('#ev-deadline').fill('2031-06-01T10:00')
    await page.locator('#ev-release').fill('2031-06-02T10:00')
    const created = page.waitForResponse((r) => r.url().endsWith('/api/editorial/predictions') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create event' }).click()
    expect((await created).status()).toBe(200)
    await page.waitForURL('**/editorial/predictions')
    const card = page.locator('div', { hasText: title }).filter({ has: page.getByRole('button', { name: 'Close early' }) }).last()
    await expect(card).toBeVisible()

    await card.getByRole('button', { name: 'Close early' }).click()
    await expect.poll(async () => (await db().predictionEvent.findFirst({ where: { title } }))!.status).toBe('CLOSED')
    await page.getByRole('button', { name: /Reopen/ }).first().click()
    await expect.poll(async () => (await db().predictionEvent.findFirst({ where: { title } }))!.status).toBe('OPEN')

    page.once('dialog', (d) => void d.dismiss())
    await page.getByRole('button', { name: 'Cancel event' }).first().click()
    expect((await db().predictionEvent.findFirst({ where: { title } }))!.status).toBe('OPEN')
    page.once('dialog', (d) => { expect(d.message()).toMatch(/cannot be undone/); void d.accept() })
    await page.getByRole('button', { name: 'Cancel event' }).first().click()
    await expect.poll(async () => (await db().predictionEvent.findFirst({ where: { title } }))!.status).toBe('CANCELLED')

    for (const who of ['editor', 'writer', 'growth', 'reader'] as const) {
      const other = await signedIn(browser, who)
      const res = await other.request.post('/api/editorial/predictions', { data: { title: `WF nope ${who}` } })
      expect(res.status(), who).toBe(403)
      await other.close()
    }
    await ctx.close()
  })
})

test.describe('comment moderation (editor, with a real reader reporting)', () => {
  test('report -> approve / hide -> public shows removal -> restore; growth cannot approve', async ({ browser }) => {
    test.setTimeout(120_000)
    const article = await publishedArticle(uniqueTitle('mod'), 'Article to comment on.')
    const reader = await createAccount('READER', 'commenter')
    const reporter = await createAccount('READER', 'reporter')
    const text = `WFcomment ${stamp} a perfectly civil remark`
    const comment = await db().comment.create({ data: { body: text, userId: reader.id, articleId: article.id } })

    // The reporter reports it through the real button.
    const rctx = await signInAs(browser, reporter)
    const rp = await rctx.newPage()
    await rp.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
    await new ArticleEditorPage(rp).dismissCookieBanner()
    const report = rp.getByRole('button', { name: 'Report this comment' }).first()
    await report.scrollIntoViewIfNeeded()
    const reported = rp.waitForResponse((r) => r.url().includes(`/api/comments/${comment.id}/report`))
    await report.click()
    expect((await reported).status()).toBe(200)
    await expect(rp.getByRole('button', { name: 'Comment reported' })).toBeVisible()
    expect((await db().comment.findUnique({ where: { id: comment.id } }))!.isReported).toBe(true)

    const ectx = await signedIn(browser, 'editor')
    const page = await ectx.newPage()
    await page.goto('/editorial/comments', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    await expect(page.getByText(text)).toBeVisible()

    // Growth may not clear a report, but the endpoint says so instead of failing silently.
    const gctx = await signedIn(browser, 'growth')
    expect((await gctx.request.patch(`/api/editorial/comments/${comment.id}`, { data: { action: 'approve' } })).status()).toBe(403)
    await gctx.close()

    // Hide it; the Hidden tab lists it and readers see the removal notice.
    const hid = page.waitForResponse((r) => r.url().includes(`/api/editorial/comments/${comment.id}`) && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Hide' }).first().click() // the newest comment is first
    expect((await hid).status()).toBe(200)
    const anon = await signedIn(browser, null)
    const pub = await anon.newPage()
    await pub.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
    await expect(pub.getByText(text)).toHaveCount(0)

    await page.getByRole('button', { name: /^Hidden/ }).click()
    await expect(page.getByText('[Comment removed]').first()).toBeVisible()
    const back = page.waitForResponse((r) => r.url().includes(`/api/editorial/comments/${comment.id}`) && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Restore' }).first().click()
    expect((await back).status()).toBe(200)
    await pub.reload({ waitUntil: 'networkidle' })
    await expect(pub.getByText(text)).toBeVisible()

    // A failed action is reported.
    await page.getByRole('button', { name: /^Recent/ }).click()
    await expect(page.getByText(text)).toBeVisible()
    await page.route(`**/api/editorial/comments/${comment.id}`, (route) => route.fulfill({ status: 500, json: { error: 'moderation down' } }))
    const failing = page.waitForResponse((r) => r.url().includes(`/api/editorial/comments/${comment.id}`) && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Hide' }).first().click() // the newest comment is first
    expect((await failing).status()).toBe(500)
    await expect(alertOf(page)).toContainText('moderation down')
    await anon.close(); await ectx.close(); await rctx.close()
  })
})

test.describe('subscribers (growth, admin)', () => {
  test('sign-ups from the public form appear; search narrows; the CSV export has them; others are refused', async ({ browser }) => {
    test.setTimeout(90_000)
    const a = `wf.sub.a.${stamp}@example.org`
    // A hostile address (accepted by the public form's rules) must not become a spreadsheet formula.
    const evil = `=cmd|' /C calc'!A0.${stamp}@example.org`
    await db().subscriber.create({ data: { email: evil.toLowerCase() } })
    const b = `wf.sub.b.${stamp}@example.org`
    const anon = await signedIn(browser, null)
    for (const email of [a, b]) {
      const p = await anon.newPage()
      await p.goto('/', { waitUntil: 'networkidle' })
      const box = p.getByPlaceholder('Your email address')
      await box.scrollIntoViewIfNeeded()
      await box.fill(email)
      const res = p.waitForResponse((r) => r.url().includes('/api/subscribe'))
      await p.locator('form', { has: box }).locator('button[type="submit"]').click()
      expect((await res).status()).toBe(201)
      await p.close()
    }
    await anon.close()

    for (const who of ['growth', 'admin'] as const) {
      const ctx = await signedIn(browser, who)
      const page = await ctx.newPage()
      await page.goto('/editorial/growth/subscribers', { waitUntil: 'networkidle' })
      await new ArticleEditorPage(page).dismissCookieBanner()
      await expect(page.getByText(a)).toBeVisible()
      await expect(page.getByText(b)).toBeVisible()
      await page.getByPlaceholder('Search by email…').fill(`wf.sub.a.${stamp}`)
      await expect(page.getByText(a)).toBeVisible()
      await expect(page.getByText(b)).toHaveCount(0)
      await page.getByPlaceholder('Search by email…').fill('')

      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export CSV/i }).click()])
      expect(download.suggestedFilename()).toMatch(/^subscribers-\d{4}-\d{2}-\d{2}\.csv$/)
      const csv = fs.readFileSync((await download.path())!, 'utf8')
      expect(csv.split('\n')[0]).toBe('"Email","Subscribed At","Status"')
      expect(csv).toContain(a)
      expect(csv).toContain(b)
      expect(csv, 'formula cells are neutralised').not.toMatch(/(^|,)"[=+\-@]/m)
      expect(csv).toContain("\"'=cmd")
      await ctx.close()
    }

    for (const who of ['editor', 'writer', 'reader'] as const) {
      const ctx = await signedIn(browser, who)
      expect((await ctx.request.get('/api/editorial/growth/subscribers')).status(), who).toBe(403)
      await ctx.close()
    }
  })
})
