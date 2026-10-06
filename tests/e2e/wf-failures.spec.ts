import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test'
import { ArticleEditorPage, articleByTitle, closeDb, confirmPublicChange, db, removeMyArticles, signedIn, uniqueTitle, writerLoginCredentials } from './helpers/workflow'

/**
 * What the editor does when saving goes wrong, and whether work survives. Failures are
 * injected at the network boundary (page.route) so the app's real client code reacts to
 * them; the typing, clicking and saving are all real UI actions.
 *
 * Every test asserts the same three things: the failure is VISIBLE to the user, the text
 * they typed is STILL IN THE EDITOR, and after the fault clears a normal save puts it in
 * the database.
 */
/** The editor's error banner (Next's route announcer is also role=alert, so exclude it). */
const alertOf = (p: Page) => p.locator('[role="alert"]:not(#__next-route-announcer__)')
const isArticleWrite = (route: Route) =>
  /\/api\/articles\/[^/?]+$/.test(route.request().url()) && ['PUT', 'PATCH'].includes(route.request().method())

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

/** A saved draft opened in the editor, as the writer. */
async function openDraft(browser: import('@playwright/test').Browser, label: string, who: 'writer' | 'editor' = 'writer') {
  const ctx = await signedIn(browser, who)
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  const title = uniqueTitle(label)
  await ed.openNew()
  await ed.title().fill(title)
  await ed.typeBody('Original text.')
  const { id } = await ed.saveNow()
  // The first save moves the page to the article's own /edit URL, which re-mounts the
  // editor. Settle there before the test starts typing or injecting faults.
  await page.waitForURL(new RegExp(`/editorial/articles/${id}/edit$`))
  await page.waitForLoadState('networkidle')
  await expect(ed.body()).toContainText('Original text.')
  return { ctx, page, ed, title, id }
}

const body = async (title: string) => (await articleByTitle(title))!.content

test.describe('a failed save is visible, loses nothing, and recovers', () => {
  test('server error (500)', async ({ browser }) => {
    const { ctx, page, ed, title } = await openDraft(browser, 'e500')
    await page.route('**/api/articles/*', (route) =>
      isArticleWrite(route) ? route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }) : route.continue())

    await ed.moveToEnd()
    await page.keyboard.type(' Typed while the server is failing.')
    await expect(alertOf(page)).toContainText('unsaved changes remain', { timeout: 10_000 })
    await expect(page.getByText('Server/database error').first()).toBeVisible()
    await expect(ed.body()).toContainText('Typed while the server is failing.')
    expect(await body(title)).not.toContain('Typed while the server')

    await page.unroute('**/api/articles/*')
    await ed.saveNow()
    await expect(alertOf(page)).toHaveCount(0)
    expect(await body(title)).toContain('Typed while the server is failing.')
    const row = (await articleByTitle(title))!
    await ed.openExisting(row.id)
    await expect(ed.body()).toContainText('Typed while the server is failing.')
    await ctx.close()
  })

  test('network failure', async ({ browser }) => {
    const { ctx, page, ed, title } = await openDraft(browser, 'net')
    await page.route('**/api/articles/*', (route) => (isArticleWrite(route) ? route.abort('failed') : route.continue()))
    await ed.moveToEnd()
    await page.keyboard.type(' Offline words.')
    await expect(alertOf(page)).toContainText('could not be reached', { timeout: 10_000 })
    await expect(ed.body()).toContainText('Offline words.')
    await page.unroute('**/api/articles/*')
    await ed.saveNow()
    expect(await body(title)).toContain('Offline words.')
    await ed.openExisting((await articleByTitle(title))!.id)
    await expect(ed.body()).toContainText('Offline words.')
    await ctx.close()
  })

  test('a save that never answers times out visibly after 15 seconds', async ({ browser }) => {
    test.setTimeout(75_000)
    const { ctx, page, ed, title } = await openDraft(browser, 'hang')
    let releaseHang!: () => void
    let finishRoute!: () => void
    const held = new Promise<void>((resolve) => { releaseHang = resolve })
    const routeFinished = new Promise<void>((resolve) => { finishRoute = resolve })
    const hangWrite = async (route: Route) => {
      if (!isArticleWrite(route)) return route.continue()
      await held
      // Resolve the intercepted request as a network failure before removing
      // the route. Otherwise Playwright continues the old timed-out PUT when
      // unroute() is called; that late mutation advances the server version and
      // the following manual save correctly receives a 409 conflict.
      await route.abort('failed').catch(() => undefined)
      finishRoute()
    }
    await page.route('**/api/articles/*', hangWrite)
    await ed.moveToEnd()
    await page.keyboard.type(' Hanging words.')
    await expect(alertOf(page)).toContainText('longer than 15 seconds', { timeout: 30_000 })
    await expect(ed.body()).toContainText('Hanging words.')
    releaseHang()
    await routeFinished
    await page.unroute('**/api/articles/*', hangWrite)
    await ed.saveNow()
    expect(await body(title)).toContain('Hanging words.')
    await ed.openExisting((await articleByTitle(title))!.id)
    await expect(ed.body()).toContainText('Hanging words.')
    await ctx.close()
  })

  test('validation error from the server (400) is shown with its reason', async ({ browser }) => {
    const { ctx, page, ed, title, id } = await openDraft(browser, 'e400')
    await page.route('**/api/articles/*', (route) =>
      isArticleWrite(route) ? route.fulfill({ status: 400, json: { error: 'Title is too long.' } }) : route.continue())
    await ed.moveToEnd()
    await page.keyboard.type(' x')
    await expect(alertOf(page)).toContainText('Title is too long.', { timeout: 10_000 })
    await page.unroute('**/api/articles/*')
    await ed.saveNow()
    expect(await body(title)).toContain('Original text. x')
    await ed.openExisting(id)
    await expect(ed.body()).toContainText('Original text. x')
    await ctx.close()
  })
})

test('typing keeps flowing across the first autosave of a new article (no keystroke lost to the page change)', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('firstsave')
  await ed.title().fill(title)
  await ed.body().click()
  let release = () => {}
  let started = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const observed = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/articles', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    started()
    await held
    await route.continue()
  })
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/articles' && r.request().method() === 'POST')
  // Wait for the real first autosave request, then type while its response is held.
  try {
    await page.keyboard.type('Part one of the text.', { delay: 20 })
    await observed
    await page.keyboard.type(' Part two keeps going while the first save lands.', { delay: 40 })
    release()
    await page.keyboard.type(' Part three too.', { delay: 40 })
    expect((await created).status()).toBe(201)
  } finally { release() }

  await expect.poll(async () => (await articleByTitle(title))?.content ?? '', { timeout: 20_000 })
    .toContain('Part three too.')
  const saved = (await articleByTitle(title))!.content
  expect(saved).toContain('Part one of the text.')
  expect(saved).toContain('Part two keeps going while the first save lands.')
  // And what is on screen is the same text.
  await expect(ed.body()).toContainText('Part three too.')
  await ed.openExisting((await articleByTitle(title))!.id)
  await expect(ed.body()).toContainText('Part one of the text. Part two keeps going while the first save lands. Part three too.')
  await ctx.close()
})

test('a slow save shows progress, locks the Save button, and completes', async ({ browser }) => {
  const { ctx, page, ed, title } = await openDraft(browser, 'slow')
  let writes = 0
  await page.route('**/api/articles/*', async (route) => {
    if (!isArticleWrite(route)) return route.continue()
    writes++
    await new Promise((r) => setTimeout(r, 3_500))
    return route.continue()
  })
  await ed.moveToEnd()
  await page.keyboard.type(' Slow words.')
  const save = ed.saveDraftButton()
  const completed = page.waitForResponse(r => /\/api\/articles\/[^/?]+$/.test(r.url()) && ['PUT', 'PATCH'].includes(r.request().method()))
  await save.click()
  await expect(page.getByText('Saving...').first()).toBeVisible()
  await expect(save).toBeDisabled()
  await expect(save).toBeDisabled()
  const bounds=await save.boundingBox();expect(bounds).toBeTruthy()
  await page.mouse.click(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2) // real repeated click on the disabled control
  expect((await completed).status()).toBe(200)
  await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 15_000 })
  expect(writes, 'one save for one click, however impatient').toBe(1)
  expect(await body(title)).toContain('Slow words.')
  await ed.openExisting((await articleByTitle(title))!.id)
  await expect(ed.body()).toContainText('Slow words.')
  await ctx.close()
})

test('typing while a save is in flight is not lost', async ({ browser }) => {
  const { ctx, page, ed, title } = await openDraft(browser, 'inflight')
  await page.route('**/api/articles/*', async (route) => {
    if (isArticleWrite(route)) await new Promise((r) => setTimeout(r, 2_500))
    return route.continue()
  })
  await ed.moveToEnd()
  await page.keyboard.type(' First burst.')
  const first = ed.saving(() => ed.saveDraftButton().click())
  await expect(page.getByText('Saving...').first()).toBeVisible()
  await ed.moveToEnd() // clicking Save moved focus to the button; a person clicks back into the text
  await page.keyboard.type(' Second burst, typed during the save.')
  expect((await first).status()).toBe(200)

  // The edit made during the save is saved by its own follow-up request.
  await expect.poll(async () => body(title), { timeout: 20_000 }).toContain('Second burst, typed during the save.')
  expect(await body(title)).toContain('First burst.')
  await ed.openExisting((await articleByTitle(title))!.id)
  await expect(ed.body()).toContainText('First burst. Second burst, typed during the save.')
  await ctx.close()
})

test('Submit pressed twice submits once and shows no error', async ({ browser }) => {
  const { ctx, page, ed, title } = await openDraft(browser, 'dbl')
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'PUT' && /\/api\/articles\/[^/?]+$/.test(r.url())) writes.push(r.postData() ?? '')
  })
  const submitted = page.waitForResponse(r => r.request().method() === 'PUT' && /\/api\/articles\/[^/?]+$/.test(r.url()) && r.request().postDataJSON()?.status === 'PENDING_REVIEW')
  await page.getByRole('button', { name: 'Submit' }).dblclick()
  expect((await submitted).status()).toBe(200)
  await expect.poll(async () => (await articleByTitle(title))!.status).toBe('PENDING_REVIEW')
  await page.waitForLoadState('networkidle')
  expect(writes.filter((w) => w.includes('"PENDING_REVIEW"')).length, 'one submit request').toBe(1)
  await expect(alertOf(page)).toHaveCount(0)
  void ed
  await ctx.close()
})

test('Save draft pressed twice before the first response creates one article', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('twice')
  await ed.title().fill(title)
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/articles' && r.request().method() === 'POST')
  await ed.saveDraftButton().dblclick()
  expect((await created).status()).toBe(201)
  await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForLoadState('networkidle')
  expect(await db().article.count({ where: { title } })).toBe(1)
  await ed.openExisting((await articleByTitle(title))!.id)
  await expect(ed.title()).toHaveValue(title)
  await ctx.close()
})

test('an expired session is reported, keeps the text, and recovers after signing in again in another tab', async ({ browser }) => {
  const { ctx, page, ed, title } = await openDraft(browser, 'expired')
  // Expire authentication only. A testing capability cannot authenticate its initiator.
  await ctx.clearCookies({ name: /^(?:__Secure-)?next-auth\.session-token$/ })
  await ed.moveToEnd()
  await page.keyboard.type(' Words typed after the session ended.')
  await expect(alertOf(page)).toContainText('session has expired', { timeout: 10_000 })
  await expect(page.getByRole('link', { name: 'Sign in again in a new tab' })).toBeVisible()
  await expect(ed.body()).toContainText('Words typed after the session ended.')
  expect(await body(title)).not.toContain('Words typed after')

  // Sign in again, as the page tells the user to, in a second tab of the same browser.
  const login = await ctx.newPage()
  await login.goto('/editorial/login')
  const credentials = writerLoginCredentials(ctx)
  await login.locator('input[type="email"]').fill(credentials.email)
  await login.locator('input[type="password"]').fill(credentials.password)
  await login.locator('button[type="submit"]').click()
  await login.waitForURL((url) => !url.pathname.includes('/login'))
  await login.close()

  await page.bringToFront()
  await ed.saveNow()
  await expect(alertOf(page)).toHaveCount(0)
  expect(await body(title)).toContain('Words typed after the session ended.')
  await ed.openExisting((await articleByTitle(title))!.id)
  await expect(ed.body()).toContainText('Words typed after the session ended.')
  await ctx.close()
})

test('a revoked account is refused with its reason and keeps the text', async ({ browser }) => {
  const { ctx, page, ed } = await openDraft(browser, 'perm')
  await page.route('**/api/articles/*', (route) =>
    isArticleWrite(route) ? route.fulfill({ status: 403, json: { error: 'Your account is suspended.', code: 'ACCOUNT_SUSPENDED' } }) : route.continue())
  await ed.moveToEnd()
  await page.keyboard.type(' y')
  await expect(alertOf(page)).toContainText('Contact an administrator', { timeout: 10_000 })
  await expect(ed.body()).toContainText('Original text. y')
  await ctx.close()
})

test.describe('the same article in two tabs', () => {
  async function twoTabs(browser: import('@playwright/test').Browser) {
    const first = await openDraft(browser, 'twotabs')
    const secondPage = await first.ctx.newPage()
    const second = new ArticleEditorPage(secondPage)
    await second.openExisting(first.id)
    return { ...first, secondPage, second }
  }

  test('a stale tab cannot silently overwrite newer work', async ({ browser }) => {
    const t = await twoTabs(browser)

    // Tab 1 changes the headline and saves.
    const newTitle = `${t.title} edited in tab one`
    await t.page.bringToFront()
    await t.ed.title().fill(newTitle)
    await t.ed.saveNow()
    expect((await articleByTitle(newTitle))!.id).toBe(t.id)

    // Tab 2 still holds the old version. It adds a sentence and saves.
    await t.secondPage.bringToFront()
    await t.second.moveToEnd()
    await t.secondPage.keyboard.type(' Sentence from tab two.')
    const res = await t.second.saving(() => t.second.saveDraftButton().click())

    // Either the save is refused with a visible conflict, or the headline survives. It
    // must never be reverted without a word.
    const row = await db().article.findUnique({ where: { id: t.id } })
    expect(res.status(), 'a stale save must be refused, not accepted').toBe(409)
    expect(row!.title, 'tab one\'s headline must survive').toBe(newTitle)
    await expect(alertOf(t.secondPage)).toContainText(/changed/i)
    await expect(t.second.body()).toContainText('Sentence from tab two.') // their work is still on screen
    await t.ctx.close()
  })

  test('after a conflict the user can keep their version deliberately', async ({ browser }) => {
    const t = await twoTabs(browser)
    await t.page.bringToFront()
    await t.ed.moveToEnd()
    await t.page.keyboard.type(' Tab one sentence.')
    await t.ed.saveNow()

    await t.secondPage.bringToFront()
    await t.second.moveToEnd()
    await t.secondPage.keyboard.type(' Tab two sentence.')
    await t.second.saving(() => t.second.saveDraftButton().click())
    await expect(alertOf(t.secondPage)).toContainText(/changed/i)

    const keep = t.secondPage.getByRole('button', { name: 'Keep my version' })
    const res = await t.second.saving(() => keep.click())
    expect(res.status()).toBe(200)
    await expect(alertOf(t.secondPage)).toHaveCount(0)
    const saved = await body(t.title)
    expect(saved).toContain('Tab two sentence.')
    await t.second.openExisting(t.id)
    await expect(t.second.body()).toContainText('Tab two sentence.')
    await expect(t.second.body()).not.toContainText('Tab one sentence.')
    await t.ctx.close()
  })
})

test('a failed publish never leaves the article public, and a later autosave does not publish it', async ({ browser }) => {
  const ctx: BrowserContext = await signedIn(browser, 'editor')
  const page: Page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('nopub')
  await ed.title().fill(title)
  await ed.typeBody('Not ready for readers.')
  await ed.saveNow()

  let fail = true
  await page.route('**/api/articles/*', (route) =>
    fail && isArticleWrite(route) ? route.fulfill({ status: 500, json: { error: 'boom' } }) : route.continue())
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await confirmPublicChange(page, 'Publish now')
  await expect(alertOf(page)).toBeVisible()
  expect((await articleByTitle(title))!.status).toBe('DRAFT')

  // The fault clears and the editor keeps typing; the autosave that follows must not publish.
  fail = false
  await ed.moveToEnd()
  const res = await ed.saving(() => page.keyboard.type(' More words.'), { timeout: 15_000 })
  expect(res.status()).toBe(200)
  expect((await articleByTitle(title))!.status, 'autosave must not publish').toBe('DRAFT')

  const anon = await signedIn(browser, null)
  const row = await articleByTitle(title)
  expect((await anon.request.get(`/articles/${row!.slug}`)).status()).toBe(404)
  await anon.close()
  await ctx.close()
})


test('after a conflict Reload latest discards only the stale tab changes', async ({ browser }) => {
  const t = await openDraft(browser, 'discard')
  const otherPage = await t.ctx.newPage()
  const other = new ArticleEditorPage(otherPage)
  await other.openExisting(t.id)
  await t.ed.moveToEnd()
  await t.page.keyboard.type(' New authoritative sentence.')
  await t.ed.saveNow()
  await other.moveToEnd()
  await otherPage.keyboard.type(' Stale local sentence.')
  expect((await other.saving(() => other.saveDraftButton().click())).status()).toBe(409)
  await expect(alertOf(otherPage)).toContainText('changed in another tab')
  await otherPage.getByRole('button', { name: 'Discard mine and reload' }).click()
  await expect(other.body()).toContainText('New authoritative sentence.')
  await expect(other.body()).not.toContainText('Stale local sentence.')
  await expect(alertOf(otherPage)).toHaveCount(0)
  expect(await body(t.title)).not.toContain('Stale local sentence.')
  await t.ctx.close()
})

test('Back to articles stays in the editor when saving fails, then saves and leaves on retry', async ({ browser }) => {
  const t = await openDraft(browser, 'back')
  await t.page.route('**/api/articles/*', route => isArticleWrite(route)
    ? route.fulfill({ status: 500, json: { error: 'Database unavailable' } }) : route.continue())
  await t.ed.moveToEnd()
  await t.page.keyboard.type(' Keep these unsaved words.')
  const failed = await t.ed.saving(() => t.page.getByRole('button', { name: 'Back to articles' }).click())
  expect(failed.status()).toBe(500)
  await expect(t.page).toHaveURL(new RegExp(`/articles/${t.id}/edit$`))
  await expect(alertOf(t.page)).toContainText('unsaved changes remain')
  await expect(t.ed.body()).toContainText('Keep these unsaved words.')
  expect(await body(t.title)).not.toContain('Keep these unsaved words.')
  await t.page.unroute('**/api/articles/*')
  expect((await t.ed.saving(() => t.page.getByRole('button', { name: 'Back to articles' }).click())).status()).toBe(200)
  await expect(t.page).toHaveURL(/\/editorial\/articles$/)
  await expect(t.page.getByText(t.title, { exact: true }).first()).toBeVisible()
  const reopened = new ArticleEditorPage(await t.ctx.newPage())
  await reopened.openExisting(t.id)
  await expect(reopened.body()).toContainText('Keep these unsaved words.')
  expect((await articleByTitle(t.title))!.status).toBe('DRAFT')
  await t.ctx.close()
})
