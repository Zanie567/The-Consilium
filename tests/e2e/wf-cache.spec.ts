import { test, expect } from '@playwright/test'
import { confirmPublicChange, ArticleEditorPage, closeDb, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'

test.afterAll(async () => { await removeMyArticles(); await closeDb() })

test('publication and unpublication immediately refresh already visited public listings', async ({ browser }) => {
  // Nine public page loads plus create/publish/unpublish exceed the default
  // 30s aggregate budget on a cold app. Individual assertions/actions stay 10s.
  test.setTimeout(90_000)
  const editor = await signedIn(browser, 'editor')
  const reader = await signedIn(browser, null)
  const page = await editor.newPage()
  const publicPage = await reader.newPage()
  const ed = new ArticleEditorPage(page)
  const title = uniqueTitle('cache')
  try {
    await ed.openNew()
    await ed.title().fill(title)
    await ed.typeBody('This article must appear immediately after publication and disappear after unpublication.')
    const panel = page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') })
    await panel.locator('select').last().selectOption({ label: 'Opinion' })
    await ed.saveNow()
    // Warm real public page caches before the mutation, through the browser.
    for (const path of ['/category/opinion', '/archive', '/']) {
      expect((await publicPage.goto(path, { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
      await expect(publicPage.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    }
    expect((await ed.saving(async () => { await page.getByRole('button', { name: 'Publish', exact: true }).click(); await confirmPublicChange(page, 'Publish now') })).status()).toBe(200)
    await expect(page.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible()
    for (const path of ['/category/opinion', '/archive', '/']) {
      expect((await publicPage.goto(path, { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
      // Archive link names also contain the date/category/author. The visible
      // title heading is the same public contract on all three listing layouts.
      await expect(publicPage.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
    }
    expect((await ed.saving(async () => { await page.getByRole('button', { name: 'Unpublish', exact: true }).click(); await confirmPublicChange(page, 'Unpublish') })).status()).toBe(200)
    for (const path of ['/category/opinion', '/archive', '/']) {
      expect((await publicPage.goto(path, { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
      await expect(publicPage.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    }
  } finally {
    await editor.close()
    await reader.close()
  }
})
