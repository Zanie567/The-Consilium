import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  ArticleEditorPage, articleByTitle, capturedEmails, closeDb, confirmDialog, confirmPublicChange, createAccount, db,
  removeMyAccounts, removeMyArticles, signInAs, signedIn, uniqueTitle, type TestAccount,
} from './helpers/workflow'

/**
 * Changes of access and the actions that affect content or access: role changes, bans, deletion and
 * restoration, scheduling. The people involved are throwaway accounts with real passwords who sign in
 * through the login form, and the admin acts through the real Users screen. The seeded shared accounts
 * are only used read-only, so these tests can demote and ban without disturbing other specs.
 *
 * The recurring question: once a tab holds unsaved work and the world has changed underneath it (the
 * article was locked, moved, the person demoted or banned), can "Keep my version" push it through anyway?
 * It must not: that button only skips the stale-version check, never the permission checks.
 */
test.afterAll(async () => {
  await removeMyArticles()
  await removeMyAccounts()
  await closeDb()
})

const alertOf = (p: Page) => p.locator('[role="alert"]:not(#__next-route-announcer__)')

// ── The admin acting through the Users screen ───────────────────────────────────────────
async function openUser(admin: BrowserContext, account: TestAccount) {
  const page = await admin.newPage()
  await page.goto('/editorial/users', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.getByPlaceholder('Search name or email...').fill(account.email)
  // Wait for the FILTERED list: the unfiltered one (newest first) already shows a brand-new account,
  // and the search results replacing it would otherwise remount the row under the click.
  await expect(page.getByText('Showing 1 to 1 of 1 users')).toBeVisible({ timeout: 15_000 })
  const row = page.locator('tr', { hasText: account.email })
  await expect(row).toBeVisible()
  return { page, row }
}

async function adminChangesRole(browser: Browser, account: TestAccount, role: string, decide: 'confirm' | 'cancel' = 'confirm') {
  const admin = await signedIn(browser, 'admin')
  const { page, row } = await openUser(admin, account)
  await row.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('button', { name: /Change Role/ }).click()
  await page.getByRole('button', { name: role, exact: true }).click()
  await expect(confirmDialog(page)).toContainText(account.name)
  await expect(confirmDialog(page)).toContainText(role)
  if (decide === 'cancel') {
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click()
  } else {
    const res = page.waitForResponse((r) => r.url().includes(`/api/admin/users/${account.id}/role`) && r.request().method() === 'PATCH')
    await confirmPublicChange(page, `Change to ${role}`)
    expect((await res).status()).toBe(200)
  }
  await admin.close()
}

async function adminBans(browser: Browser, account: TestAccount, action: 'ban' | 'unban') {
  const admin = await signedIn(browser, 'admin')
  const { page, row } = await openUser(admin, account)
  await row.click() // opens the profile panel
  if (action === 'ban') {
    await page.getByRole('button', { name: 'Ban', exact: true }).click()
    await page.getByPlaceholder('Reason for ban (visible to the user)...').fill('Test of a suspension')
    const res = page.waitForResponse((r) => r.url().includes(`/api/admin/users/${account.id}/ban`))
    await page.getByRole('button', { name: 'Confirm Ban' }).click()
    expect((await res).status()).toBe(200)
  } else {
    const res = page.waitForResponse((r) => r.url().includes(`/api/admin/users/${account.id}/unban`))
    await page.getByRole('button', { name: 'Unban', exact: true }).click()
    expect((await res).status()).toBe(200)
  }
  await admin.close()
}

test.describe('role changes', () => {
  test('promote then demote: access follows at once, a cancelled change changes nothing, and the person is emailed', async ({ browser }) => {
    test.setTimeout(120_000) // several admin round trips, each in a fresh signed-in browser
    const acct = await createAccount('WRITER', 'promote')
    const person = await signInAs(browser, acct)
    const page = await person.newPage()

    // As a writer: no review screen, no moderation feed.
    await page.goto('/editorial/review', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/editorial$/)
    expect((await person.request.get('/api/editorial/comments')).status()).toBe(401)

    await adminChangesRole(browser, acct, 'EDITOR', 'cancel')
    expect((await db().user.findUnique({ where: { id: acct.id } }))!.role).toBe('WRITER')

    await adminChangesRole(browser, acct, 'EDITOR')
    expect((await db().user.findUnique({ where: { id: acct.id } }))!.role).toBe('EDITOR')
    await expect.poll(() => capturedEmails().filter((m) => m.to === acct.email).length).toBeGreaterThan(0)

    // Every API call re-reads the role from the database, so no re-login is needed for the new
    // powers to work. Server-rendered page/session guards also read fresh account state.
    const asEditor = await person.request.get('/api/editorial/comments')
    expect(asEditor.status(), 'a promoted editor can use editor endpoints at once').toBe(200)

    // Demoted to reader: the portal and the article APIs close immediately.
    await adminChangesRole(browser, acct, 'READER')
    await page.goto('/editorial/articles/new', { waitUntil: 'networkidle' })
    await expect(page.getByText('Access Denied')).toBeVisible()
    const api = await person.request.post('/api/articles', { data: { title: uniqueTitle('demoted'), content: '{}', status: 'DRAFT' } })
    expect(api.status()).toBe(403)
    await person.close()
  })

  test('the Users screen reports a refused role change instead of failing silently', async ({ browser }) => {
    const acct = await createAccount('WRITER', 'refused')
    const admin = await signedIn(browser, 'admin')
    const { page, row } = await openUser(admin, acct)
    await page.route(`**/api/admin/users/${acct.id}/role`, (route) => route.fulfill({ status: 500, json: { error: 'role service down' } }))
    await row.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('button', { name: /Change Role/ }).click()
    await page.getByRole('button', { name: 'EDITOR', exact: true }).click()
    await confirmPublicChange(page, 'Change to EDITOR')
    await expect(page.getByText(/role service down|could not|failed/i).first()).toBeVisible()
    expect((await db().user.findUnique({ where: { id: acct.id } }))!.role).toBe('WRITER')
    await admin.close()
  })

  test('nobody below Admin can change roles', async ({ browser }) => {
    const target = await createAccount('READER', 'target')
    for (const who of ['editor', 'writer', 'growth', 'reader'] as const) {
      const ctx = await signedIn(browser, who)
      const res = await ctx.request.patch(`/api/admin/users/${target.id}/role`, { data: { role: 'ADMIN' } })
      expect([401, 403], `${who} got ${res.status()}`).toContain(res.status())
      await ctx.close()
    }
    expect((await db().user.findUnique({ where: { id: target.id } }))!.role).toBe('READER')
  })
})

test.describe('"Keep my version" never bypasses a lock, a ban, a demotion or a category scope', () => {
  /** Two tabs on one article; tab 2 saves first, so tab 1 is stale and shows the conflict banner. */
  async function staleTab(browser: Browser, who: TestAccount, label: string, body = 'Original text.') {
    const ctx = await signInAs(browser, who)
    const tab1 = await ctx.newPage()
    const ed1 = new ArticleEditorPage(tab1)
    await ed1.openNew()
    const title = uniqueTitle(label)
    await ed1.title().fill(title)
    await ed1.typeBody(body)
    const { id } = await ed1.saveNow()
    await tab1.waitForLoadState('networkidle')

    const tab2 = await ctx.newPage()
    const ed2 = new ArticleEditorPage(tab2)
    await ed2.openExisting(id)
    return { ctx, tab1, ed1, tab2, ed2, id, title }
  }
  const content = async (id: string) => (await db().article.findUnique({ where: { id } }))!.content

  async function makeTab1Stale(t: Awaited<ReturnType<typeof staleTab>>) {
    await t.tab2.bringToFront()
    await t.ed2.moveToEnd()
    await t.tab2.keyboard.type(' Saved from tab two.')
    await t.ed2.saveNow()
    await t.tab1.bringToFront()
    await t.ed1.moveToEnd()
    await t.tab1.keyboard.type(' Tab one words.')
    await t.ed1.saving(() => t.ed1.saveDraftButton().click())
    await expect(alertOf(t.tab1)).toContainText(/changed/i)
  }

  test('a writer whose article was submitted from another tab cannot save over the locked article', async ({ browser }) => {
    const writer = await createAccount('WRITER', 'locked')
    const t = await staleTab(browser, writer, 'lock')
    await makeTab1Stale(t)
    // Tab 2 submits the article for review: it is now locked for the writer.
    await t.tab2.bringToFront()
    await t.ed2.saving(() => t.tab2.getByRole('button', { name: 'Submit' }).click())
    expect((await db().article.findUnique({ where: { id: t.id } }))!.status).toBe('PENDING_REVIEW')
    const before = await content(t.id)

    await t.tab1.bringToFront()
    const keep = await t.ed1.saving(() => t.tab1.getByRole('button', { name: 'Keep my version' }).click())
    expect(keep.status(), 'a locked article refuses even a deliberate overwrite').toBe(400)
    expect(await content(t.id)).toBe(before)
    expect(await content(t.id)).not.toContain('Tab one words.')
    await expect(alertOf(t.tab1)).toBeVisible()
    await expect(t.ed1.body()).toContainText('Tab one words.') // their text is still on screen, not lost
    await t.ctx.close()
  })

  test('a demoted editor cannot overwrite, and can again once restored', async ({ browser }) => {
    test.setTimeout(120_000) // several admin round trips, each in a fresh signed-in browser
    const editor = await createAccount('EDITOR', 'demoted')
    const t = await staleTab(browser, editor, 'demote')
    await makeTab1Stale(t)
    const before = await content(t.id)

    await adminChangesRole(browser, editor, 'READER')
    await t.tab1.bringToFront()
    const keep = await t.ed1.saving(() => t.tab1.getByRole('button', { name: 'Keep my version' }).click())
    expect(keep.status()).toBe(403)
    expect(await content(t.id)).toBe(before)

    await adminChangesRole(browser, editor, 'EDITOR')
    const again = await t.ed1.saving(() => t.ed1.saveDraftButton().click())
    expect(again.status()).toBe(200)
    await t.ctx.close()
  })

  test('a banned account cannot save, with a visible reason; unbanning restores it', async ({ browser }) => {
    test.setTimeout(120_000) // several admin round trips, each in a fresh signed-in browser
    const writer = await createAccount('WRITER', 'banned')
    const t = await staleTab(browser, writer, 'ban')
    await makeTab1Stale(t)
    const before = await content(t.id)

    await adminBans(browser, writer, 'ban')
    await t.tab1.bringToFront()
    const blockedRead = t.tab1.waitForResponse(r => new URL(r.url()).pathname === `/api/articles/${t.id}` && r.request().method() === 'GET')
    const writes: string[] = []
    t.tab1.on('request', r => { if (new URL(r.url()).pathname === `/api/articles/${t.id}` && r.method() === 'PUT') writes.push(r.url()) })
    await t.tab1.getByRole('button', { name: 'Keep my version' }).click()
    const keep = await blockedRead
    expect(keep.status()).toBe(403)
    await expect(alertOf(t.tab1)).toContainText(/suspended|contact an administrator/i)
    expect(await content(t.id)).toBe(before)
    await expect(t.ed1.body()).toContainText('Tab one words.')
    expect(writes).toEqual([])

    await adminBans(browser, writer, 'unban')
    const stale = await t.ed1.saving(() => t.ed1.saveDraftButton().click())
    expect(stale.status()).toBe(409)
    const ok = await t.ed1.saving(() => t.tab1.getByRole('button', { name: 'Keep my version' }).click())
    expect(ok.status()).toBe(200)
    await t.ctx.close()
  })

  test('a category-scoped editor cannot overwrite an article that has been moved out of their scope', async ({ browser }) => {
    const scopedUser = await db().user.findUnique({ where: { email: 'editor.opinion@consilium.test' } })
    const opinion = await db().category.findFirst({ where: { slug: 'opinion' } })
    const other = await db().category.findFirst({ where: { slug: { not: 'opinion' } } })
    expect(scopedUser && opinion && other, 'seeded scoped editor and categories exist').toBeTruthy()

    const scoped = await browser.newContext({ storageState: (await import('./helpers/authStorage')).EDITOR_SCOPED_STORAGE })
    const tab1 = await scoped.newPage()
    const ed1 = new ArticleEditorPage(tab1)
    await ed1.openNew()
    // A scoped editor cannot save an uncategorised article, so the category comes first.
    // (For editors the first <select> is Status, so find the category one by its "No category" option.)
    await tab1.locator('aside', { has: tab1.getByPlaceholder('Add a tag, press Enter...') })
      .locator('select', { has: tab1.locator('option', { hasText: 'No category' }) }).selectOption({ value: opinion!.id })
    const title = uniqueTitle('scope')
    await ed1.title().fill(title)
    await ed1.typeBody('Opinion text.')
    const { id } = await ed1.saveNow()
    await tab1.waitForLoadState('networkidle')

    // Someone with wider scope (here: the database, standing in for an admin's category change) moves it away.
    await db().article.update({ where: { id }, data: { categoryId: other!.id, title: `${title} (moved)` } })
    const before = (await db().article.findUnique({ where: { id } }))!.content

    await ed1.moveToEnd()
    await tab1.keyboard.type(' Words typed after the move.')
    await ed1.saving(() => ed1.saveDraftButton().click())
    const alert = alertOf(tab1)
    await expect(alert).toBeVisible()
    // Whatever the first refusal says, "Keep my version" must not get through either.
    const keepBtn = tab1.getByRole('button', { name: 'Keep my version' })
    if (await keepBtn.count()) {
      const blockedRead = tab1.waitForResponse(r => new URL(r.url()).pathname === `/api/articles/${id}` && r.request().method() === 'GET')
      const writes: string[] = []
      tab1.on('request', r => { if (new URL(r.url()).pathname === `/api/articles/${id}` && r.method() === 'PUT') writes.push(r.url()) })
      await keepBtn.click()
      const keep = await blockedRead
      expect(keep.status()).toBe(403)
      await expect(alert).toContainText(/outside your assigned categories/i)
      expect(writes).toEqual([])
    }
    expect((await db().article.findUnique({ where: { id } }))!.content).toBe(before)
    expect((await db().article.findUnique({ where: { id } }))!.categoryId).toBe(other!.id)
    await expect(ed1.body()).toContainText('Words typed after the move.')
    await scoped.close()
  })
})

test.describe('deleting an account', () => {
  test('the confirmation says their articles go too; deleting needs the typed email, removes a published article from the site, and ends their access', async ({ browser }) => {
    test.setTimeout(120_000)
    const writer = await createAccount('WRITER', 'doomed')
    const ctx = await signInAs(browser, writer)
    const page = await ctx.newPage()
    const ed = new ArticleEditorPage(page)
    await ed.openNew()
    const title = uniqueTitle('doomed')
    await ed.title().fill(title)
    await ed.typeBody('Published by an account that will be deleted.')
    const { id } = await ed.saveNow()
    await db().article.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } })
    const slug = (await db().article.findUnique({ where: { id } }))!.slug
    const anon = await signedIn(browser, null)
    expect((await anon.request.get(`/articles/${slug}`)).status()).toBe(200)

    const admin = await signedIn(browser, 'admin')
    const { page: ap, row } = await openUser(admin, writer)
    await row.click()
    await ap.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(ap.getByTestId('delete-consequence')).toContainText('1 of their articles')
    await expect(ap.getByTestId('delete-consequence')).toContainText('published')
    const confirm = ap.getByRole('button', { name: 'Delete Account' })
    await expect(confirm, 'disabled until the email is typed').toBeDisabled()
    await ap.getByPlaceholder(writer.email).fill('someone.else@example.com')
    await expect(confirm).toBeDisabled()
    await ap.getByPlaceholder(writer.email).fill(writer.email)
    const res = ap.waitForResponse((r) => r.url().includes(`/api/admin/users/${writer.id}`) && r.request().method() === 'DELETE')
    await confirm.click()
    expect((await res).status()).toBe(200)
    await admin.close()

    expect(await db().user.findUnique({ where: { id: writer.id } })).toBeNull()
    expect((await anon.request.get(`/articles/${slug}`)).status(), 'their published article is gone from the site').toBe(404)
    // The deleted person's open session no longer works.
    const api = await ctx.request.post('/api/articles', { data: { title: uniqueTitle('ghost'), content: '{}', status: 'DRAFT' } })
    expect([401, 403]).toContain(api.status())
    await anon.close()
    await ctx.close()
  })
})

test.describe('deletion and restoration', () => {
  test('a writer trashes and restores their own draft; no one else can touch it', async ({ browser }) => {
    const owner = await createAccount('WRITER', 'owner')
    const other = await createAccount('WRITER', 'other')
    const ctx = await signInAs(browser, owner)
    const page = await ctx.newPage()
    const ed = new ArticleEditorPage(page)
    await ed.openNew()
    const title = uniqueTitle('del')
    await ed.title().fill(title)
    await ed.typeBody('Keep this text.')
    const { id } = await ed.saveNow()

    // Others are refused, on delete and on restore.
    const intruder = await signInAs(browser, other)
    expect((await intruder.request.delete(`/api/articles/${id}`)).status()).toBe(403)
    for (const who of ['reader', 'growth'] as const) {
      const c = await signedIn(browser, who)
      expect([401, 403]).toContain((await c.request.delete(`/api/articles/${id}`)).status())
      await c.close()
    }
    expect((await db().article.findUnique({ where: { id } }))!.deletedAt).toBeNull()

    // The owner deletes through the list, after the confirm.
    await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
    await ed.dismissCookieBanner()
    page.once('dialog', (d) => void d.accept())
    await page.locator('tr', { hasText: title }).getByRole('button', { name: 'Delete article' }).click()
    await expect.poll(async () => (await db().article.findUnique({ where: { id } }))!.deletedAt).not.toBeNull()

    expect((await intruder.request.patch(`/api/editorial/trash/${id}`)).status(), 'another writer cannot restore it').toBe(403)
    expect((await db().article.findUnique({ where: { id } }))!.deletedAt).not.toBeNull()

    await page.goto('/editorial/trash', { waitUntil: 'networkidle' })
    const item = page.locator('div', { hasText: title }).filter({ has: page.getByRole('button', { name: /restore/i }) }).last()
    await item.getByRole('button', { name: /restore/i }).click()
    await expect.poll(async () => (await db().article.findUnique({ where: { id } }))!.deletedAt).toBeNull()
    expect((await db().article.findUnique({ where: { id } }))!.content).toContain('Keep this text.')
    await intruder.close()
    await ctx.close()
  })

  test('a writer cannot take their own submitted or published article down by deleting it', async ({ browser }) => {
    const writer = await createAccount('WRITER', 'nodelete')
    const ctx = await signInAs(browser, writer)
    const page = await ctx.newPage()
    const ed = new ArticleEditorPage(page)
    await ed.openNew()
    const title = uniqueTitle('lockdel')
    await ed.title().fill(title)
    await ed.typeBody('Submitted text.')
    const { id } = await ed.saveNow()
    await ed.saving(() => page.getByRole('button', { name: 'Submit' }).click())

    // Pending review: neither the API nor the list offers deletion.
    expect((await ctx.request.delete(`/api/articles/${id}`)).status()).toBe(403)
    await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
    await expect(page.locator('tr', { hasText: title })).toBeVisible()
    await expect(page.locator('tr', { hasText: title }).getByRole('button', { name: 'Delete article' })).toHaveCount(0)

    // Published: same.
    await db().article.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } })
    expect((await ctx.request.delete(`/api/articles/${id}`)).status()).toBe(403)
    const slug = (await db().article.findUnique({ where: { id } }))!.slug
    const anon = await signedIn(browser, null)
    expect((await anon.request.get(`/articles/${slug}`)).status(), 'still public').toBe(200)
    await anon.close()
    await ctx.close()
  })

  test('a category-scoped editor can neither trash nor restore articles outside their scope', async ({ browser }) => {
    const opinion = await db().category.findFirst({ where: { slug: 'opinion' } })
    const other = await db().category.findFirst({ where: { slug: { not: 'opinion' } } })
    const author = await createAccount('WRITER', 'scopeauthor')
    const outside = await db().article.create({
      data: { title: uniqueTitle('outside'), slug: `wf-outside-${Date.now().toString(36)}`, content: '{}', authorId: author.id, categoryId: other!.id, status: 'DRAFT' },
    })
    const trashed = await db().article.create({
      data: { title: uniqueTitle('trashedoutside'), slug: `wf-trashed-${Date.now().toString(36)}`, content: '{}', authorId: author.id, categoryId: other!.id, status: 'DRAFT', deletedAt: new Date() },
    })
    const scoped = await browser.newContext({ storageState: (await import('./helpers/authStorage')).EDITOR_SCOPED_STORAGE })
    expect(opinion).toBeTruthy()
    const del = await scoped.request.delete(`/api/articles/${outside.id}`)
    expect(del.status()).toBe(403)
    expect((await del.json()).code).toBe('CATEGORY_SCOPE_DENIED')
    const restore = await scoped.request.patch(`/api/editorial/trash/${trashed.id}`)
    expect(restore.status()).toBe(403)
    expect((await db().article.findUnique({ where: { id: outside.id } }))!.deletedAt).toBeNull()
    expect((await db().article.findUnique({ where: { id: trashed.id } }))!.deletedAt).not.toBeNull()
    await scoped.close()
  })
})

test.describe('scheduling from the editor', () => {
  test('staging a schedule saves nothing; Schedule asks, validates and confirms; the time moves only when re-scheduled', async ({ browser }) => {
    const ctx = await signedIn(browser, 'editor')
    const page = await ctx.newPage()
    const ed = new ArticleEditorPage(page)
    await ed.openNew()
    const title = uniqueTitle('sched')
    await ed.title().fill(title)
    await ed.typeBody('To be scheduled.')
    const { id } = await ed.saveNow()
    await page.waitForLoadState('networkidle')
    const slug = (await articleByTitle(title))!.slug
    const writes: string[] = []
    page.on('request', (r) => { if (/\/api\/articles\/[^/?]+$/.test(r.url()) && ['PUT', 'PATCH'].includes(r.method())) writes.push(r.postData() ?? '') })
    const panel = page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') })

    await panel.locator('select').first().selectOption('SCHEDULED')
    const date = panel.locator('input[type="datetime-local"]')
    await expect(date).toBeVisible()
    await page.waitForTimeout(3_000)
    expect(writes, 'staging the status must save nothing').toHaveLength(0)

    // No date yet: the button says so and nothing is sent or confirmed.
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(alertOf(page)).toContainText(/future date/i)
    await expect(confirmDialog(page)).toHaveCount(0)

    // A date in the past is refused by the server and reported.
    await date.fill('2020-01-01T10:00')
    await page.waitForTimeout(2_500)
    expect(writes, 'changing the date must not autosave').toHaveLength(0)
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await confirmPublicChange(page, 'Schedule')
    await expect(alertOf(page)).toContainText(/future/i)
    expect((await articleByTitle(title))!.status).toBe('DRAFT')

    // A future date: the dialog names the time; Cancel changes nothing; Confirm schedules.
    await date.fill('2031-06-01T10:00')
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(confirmDialog(page)).toContainText('2031-06-01 10:00')
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click()
    expect((await articleByTitle(title))!.status).toBe('DRAFT')
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await confirmPublicChange(page, 'Schedule')
    await expect.poll(async () => (await articleByTitle(title))!.status).toBe('SCHEDULED')
    const first = (await articleByTitle(title))!.scheduledAt!
    const anon = await signedIn(browser, null)
    expect((await anon.request.get(`/articles/${slug}`)).status(), 'scheduled is not public').toBe(404)

    // Ordinary edits keep it scheduled for the same time.
    await ed.moveToEnd()
    const res = await ed.saving(() => page.keyboard.type(' More text.'), { timeout: 15_000 })
    expect(res.status()).toBe(200)
    const after = (await articleByTitle(title))!
    expect(after.status).toBe('SCHEDULED')
    expect(after.scheduledAt!.getTime()).toBe(first.getTime())

    // Changing the date alone does not re-time it…
    await date.fill('2032-01-01T09:00')
    await page.waitForTimeout(3_000)
    expect((await articleByTitle(title))!.scheduledAt!.getTime()).toBe(first.getTime())
    // …the Schedule button does, after confirmation.
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await confirmPublicChange(page, 'Schedule')
    await expect.poll(async () => (await articleByTitle(title))!.scheduledAt!.getTime()).not.toBe(first.getTime())

    // Cancelling the schedule is explicit too.
    await panel.locator('select').first().selectOption('DRAFT')
    await page.getByRole('button', { name: 'Set to Draft' }).click()
    await confirmPublicChange(page, 'Unpublish')
    await expect.poll(async () => (await articleByTitle(title))!.status).toBe('DRAFT')
    expect((await articleByTitle(title))!.scheduledAt).toBeNull()
    await anon.close()
    void id
    await ctx.close()
  })

  test('a writer cannot schedule: no status control, and the API ignores the request', async ({ browser }) => {
    const writer = await createAccount('WRITER', 'nosched')
    const ctx = await signInAs(browser, writer)
    const page = await ctx.newPage()
    const ed = new ArticleEditorPage(page)
    await ed.openNew()
    const title = uniqueTitle('wsched')
    await ed.title().fill(title)
    const { id } = await ed.saveNow()
    await expect(page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') }).locator('input[type="datetime-local"]')).toHaveCount(0)
    const res = await ctx.request.put(`/api/articles/${id}`, { data: { title, status: 'SCHEDULED', scheduledAt: '2031-06-01T10:00', publicationIntent: true } })
    expect(res.status()).toBe(200)
    expect((await res.json()).status).toBe('DRAFT')
    await ctx.close()
  })
})
