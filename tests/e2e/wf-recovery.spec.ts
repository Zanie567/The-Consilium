import { test, expect } from '@playwright/test'
import {
  ArticleEditorPage,
  signedIn,
  uniqueTitle,
  articleByTitle,
  removeMyArticles,
  closeDb,
  db,
} from './helpers/workflow'

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

test('refresh and tab closure retain exact unsaved work; recovery requires deliberate Save', async ({
  browser,
}) => {
  test.setTimeout(90_000) // Includes interrupted save, refresh, closed tab, explicit recovery and fresh reopen.
  const ctx = await signedIn(browser, 'writer')
  let page = await ctx.newPage()
  let ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('local-recovery')
  await ed.title().fill(title)
  await ed.typeBody('Server text.')
  const { id } = await ed.saveNow()
  await page.route('**/api/articles/*', async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed')
    else await route.continue()
  })
  await ed.title().fill(title + ' unsaved')
  await ed.moveToEnd()
  await page.keyboard.type(' Exact unsaved punctuation: £4.25 & <local>.')
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => Object.keys(localStorage).filter((k) => k.startsWith('consilium:draft:')).length
        )
    )
    .toBeGreaterThan(0)
  page.on('dialog', (d) => void d.accept())
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: 'Recover local work' })).toBeVisible()
  await expect(ed.title()).toBeDisabled()
  await expect(ed.excerpt()).toBeDisabled()
  await expect(ed.body()).toHaveText('Server text.')
  await page.getByRole('button', { name: 'Recover local work' }).click()
  await expect(ed.title()).toBeEnabled()
  await expect(ed.body()).toContainText('Exact unsaved punctuation: £4.25 & <local>.')
  await expect(ed.title()).toHaveValue(title + ' unsaved')
  await expect(
    page.getByRole('status', { name: '' }).filter({ hasText: 'Recovered local work' })
  ).toBeVisible()
  expect((await articleByTitle(title))!.content).not.toContain('Exact unsaved')
  await page.close({ runBeforeUnload: false })
  page = await ctx.newPage()
  ed = new ArticleEditorPage(page)
  await ed.openExisting(id)
  await page.getByRole('button', { name: 'Recover local work' }).click()
  await expect(ed.body()).toContainText('Exact unsaved punctuation: £4.25 & <local>.')
  await ed.saveNow()
  const reopened = await ctx.newPage()
  await new ArticleEditorPage(reopened).openExisting(id)
  await expect(new ArticleEditorPage(reopened).body()).toContainText(
    'Exact unsaved punctuation: £4.25 & <local>.'
  )
  await expect(reopened.getByRole('button', { name: 'Recover local work' })).toHaveCount(0)
  expect((await articleByTitle(title + ' unsaved'))!.status).toBe('DRAFT')
  await ctx.close()
})

test('stale recovery refuses silent overwrite and never changes publication status', async ({
  browser,
}) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('stale-recovery')
  await ed.title().fill(title)
  await ed.typeBody('Initial server text.')
  const { id } = await ed.saveNow()
  await page.route('**/api/articles/*', async (r) =>
    r.request().method() === 'PUT' ? r.abort('failed') : r.continue()
  )
  await ed.moveToEnd()
  await page.keyboard.type(' Local stale work.')
  const separate = await signedIn(browser, 'writer')
  const newer = await separate.newPage()
  const second = new ArticleEditorPage(newer)
  await second.openExisting(id)
  await second.moveToEnd()
  await newer.keyboard.type(' New server content.')
  await second.saveNow()
  await separate.close()
  page.on('dialog', (d) => void d.accept())
  await page.unrouteAll()
  await page.reload({ waitUntil: 'networkidle' })
  await expect(
    page.getByText('The server has changed since this copy.', { exact: false })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Recover local work' }).click()
  expect((await ed.saving(() => ed.saveDraftButton().click())).status()).toBe(409)
  await expect(page.getByRole('button', { name: 'Keep my version' })).toBeVisible()
  expect((await articleByTitle(title))!.content).toContain('New server content.')
  expect((await articleByTitle(title))!.status).toBe('DRAFT')
  await page.getByRole('button', { name: 'Discard mine and reload' }).click()
  await expect(ed.body()).toContainText('New server content.')
  await expect(ed.body()).not.toContainText('Local stale work.')
  await ctx.close()
})

test('another signed-in account cannot recover a writer draft stored on the same device', async ({
  browser,
}) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('owned-recovery')
  await ed.title().fill(title)
  await ed.typeBody('Saved.')
  const { id } = await ed.saveNow()
  await page.route('**/api/articles/*', async (r) =>
    r.request().method() === 'PUT' ? r.abort('failed') : r.continue()
  )
  await ed.moveToEnd()
  await page.keyboard.type(' Private local work.')
  const row = await db().article.findUniqueOrThrow({ where: { id } })
  expect(row.authorId).toBeTruthy()
  const admin = await signedIn(browser, 'admin')
  await ctx.clearCookies()
  await ctx.addCookies(await admin.cookies())
  page.on('dialog', (d) => void d.accept())
  await page.unrouteAll()
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: 'Recover local work' })).toHaveCount(0)
  await expect(ed.body()).not.toContainText('Private local work.')
  await admin.close()
  await ctx.close()
})

test('deleted originals remain recoverable deliberately as new drafts; expired copies can be downloaded', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('missing-recovery')
  await ed.title().fill(title)
  await ed.typeBody('Saved original.')
  const { id } = await ed.saveNow()
  await page.route('**/api/articles/*', async (r) =>
    r.request().method() === 'PUT' ? r.abort() : r.continue()
  )
  await ed.moveToEnd()
  await page.keyboard.type(' Exact retained local body.')
  await expect
    .poll(() =>
      page.evaluate(
        () => Object.keys(localStorage).filter((k) => k.startsWith('consilium:draft:')).length
      )
    )
    .toBeGreaterThan(0)
  await db().article.update({ where: { id }, data: { deletedAt: new Date() } })
  page.on('dialog', (d) => void d.accept())
  await page.goto('/editorial/recovery', { waitUntil: 'networkidle' })
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  await card.getByRole('link', { name: 'Open original article' }).click()
  await expect(page.getByText('404', { exact: true })).toBeVisible()
  // Not networkidle: leaving the previous page cancels its link prefetches, which Playwright keeps counting as
  // in flight, so the load can never be called idle. The card's own button below waits for the page to be usable.
  await page.goto('/editorial/recovery')
  const downloaded = page.waitForEvent('download')
  await card.getByRole('button', { name: 'Download local copy' }).click()
  const copy=await downloaded
  expect(copy.suggestedFilename()).toBe('consilium-unsaved-draft.json')
  expect(await copy.failure()).toBeNull()
  await copy.delete()
  await card.getByRole('button', { name: 'Recover as new draft' }).click()
  await page.getByRole('button', { name: 'Recover local work' }).click()
  await expect(ed.body()).toContainText('Exact retained local body.')
  await page.unrouteAll()
  const created = await ed.saveNow()
  expect(created.id).not.toBe(id)
  expect((await db().article.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('DRAFT')
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('consilium:draft:')) {
        const d = JSON.parse(localStorage.getItem(key)!)
        d.at = Date.now() - 31 * 24 * 60 * 60 * 1000
        localStorage.setItem(key, JSON.stringify(d))
      }
    }
  })
  await page.goto('/editorial/recovery', { waitUntil: 'networkidle' })
  await expect(card.getByText(/expired/).first()).toBeVisible()
  await expect(card.getByRole('button', { name: 'Recover as new draft' })).toHaveCount(0)
  await card.getByRole('button', { name: 'Discard local copy' }).click()
  await expect(card).toHaveCount(0)
  await ctx.close()
})

test('browser restart retains local work without persisting or publishing it', async ({
  browser,
  browserName,
}) => {
  test.setTimeout(90_000)
  const engine = (await import('@playwright/test'))[browserName]
  const auth = await signedIn(browser, 'writer')
  const firstBrowser = await engine.launch()
  const first = await firstBrowser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    storageState: await auth.storageState(),
  })
  await auth.close()
  const page = await first.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('restart')
  await ed.title().fill(title)
  await ed.typeBody('Saved before restart.')
  const { id } = await ed.saveNow()
  await page.route('**/api/articles/*', async (r) =>
    r.request().method() === 'PUT' ? r.abort() : r.continue()
  )
  await ed.moveToEnd()
  await page.keyboard.type(' Unsaved after restart.')
  const state = await first.storageState()
  await firstBrowser.close()
  const secondBrowser = await engine.launch()
  try {
    const ctx = await secondBrowser.newContext({
      baseURL: process.env.E2E_BASE_URL,
      storageState: state,
    })
    const reopened = await ctx.newPage()
    const restored = new ArticleEditorPage(reopened)
    await restored.openExisting(id)
    await reopened.getByRole('button', { name: 'Recover local work' }).click()
    await expect(restored.body()).toContainText('Unsaved after restart.')
    expect((await articleByTitle(title))!.content).not.toContain('Unsaved after restart.')
    expect((await articleByTitle(title))!.status).toBe('DRAFT')
    await restored.saveNow()
    expect((await articleByTitle(title))!.content).toContain('Unsaved after restart.')
  } finally {
    await secondBrowser.close()
  }
})
