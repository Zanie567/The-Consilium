import { test, expect } from '@playwright/test'
import { ArticleEditorPage, articleByTitle, closeDb, db, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'

test.afterAll(async () => { await removeMyArticles(); await closeDb() })

test('delete table, edit/cancel/remove footnotes, spacing, counts and theme survive saving', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('controls')
  await ed.title().fill(title)
  await ed.typeBody('Four words for counts.')
  await expect(page.getByText('4 words', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('1 min read', { exact: true }).first()).toBeVisible()

  const bar = page.locator('div.fixed.top-0', { has: ed.saveDraftButton() })
  await bar.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await bar.getByRole('button', { name: 'Switch to light mode', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  for (const [label, value] of [['Single (1.0)', '1'], ['1.15', '1.15'], ['1.5', '1.5'], ['Double (2.0)', '2']]) {
    await ed.select('Four words for counts.')
    await ed.tool('Line spacing').click()
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(ed.body().locator('span[style*="line-height"]')).toHaveAttribute('style', `line-height: ${value};`)
  }
  await ed.moveToEnd()
  page.once('dialog', d => void d.accept('Original footnote'))
  await ed.tool('Insert footnote').click()
  const note = ed.body().locator('sup[data-footnote]')
  const editNote = async (value: string | null) => {
    // The editor interprets rapid repeated marker clicks as double/triple
    // selection, not a new edit. Model distinct prompt interactions.
    await page.waitForTimeout(600)
    await Promise.all([
      page.waitForEvent('dialog').then(async dialog => {
        expect(dialog.message()).toBe('Footnote text (clear it to remove this footnote):')
        if (value === null) await dialog.dismiss()
        else await dialog.accept(value)
      }),
      note.click(),
    ])
  }
  await editNote('Revised footnote')
  await expect(note).toHaveAttribute('data-footnote', 'Revised footnote')
  await editNote(null)
  await expect(note).toHaveAttribute('data-footnote', 'Revised footnote')
  await editNote('')
  await expect(note).toHaveCount(0)
  await ed.moveToEnd()
  page.once('dialog', d => void d.accept('Retained footnote'))
  await ed.tool('Insert footnote').click()
  await ed.moveToEnd()
  await page.keyboard.press('Enter')
  await ed.tool('Insert table').click()
  await page.locator('div.grid button').nth(11).click()
  await expect(ed.body().locator('table')).toHaveCount(1)
  await ed.body().locator('table th').first().click()
  await ed.tool('Delete table').click()
  await expect(ed.body().locator('table')).toHaveCount(0)
  const { id } = await ed.saveNow()
  await ed.openExisting(id)
  await expect(ed.body()).toContainText('Four words for counts.')
  await expect(ed.body().locator('span[style*="line-height"]').first()).toHaveAttribute('style', 'line-height: 2;')
  await expect(ed.body().locator('sup[data-footnote]')).toHaveAttribute('data-footnote', 'Retained footnote')
  await expect(ed.body().locator('table')).toHaveCount(0)
  expect((await articleByTitle(title))!.content).not.toContain('Original footnote')
  await ctx.close()
})

test('review correction, commendation, feature and pin persist and corrections appear publicly', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  const featuredBefore = await db().article.findMany({ where: { isFeatured: true }, select: { id: true } })
  try {
    await ed.openNew()
    const title = uniqueTitle('review-controls')
    await ed.title().fill(title)
    await ed.typeBody('A body that will receive a correction.')
    const { id } = await ed.saveNow()
    expect((await ed.saving(() => page.getByRole('button', { name: 'Publish', exact: true }).click())).status()).toBe(200)
    await page.goto(`/editorial/review/${id}`, { waitUntil: 'networkidle' })
    await page.getByRole('checkbox', { name: 'Mark as corrected' }).check()
    const correction = 'Corrected the reported rate to 4.5 percent.'
    await page.getByPlaceholder('Correction note').fill(correction)
    const wait = page.waitForResponse(r => r.url().endsWith(`/articles/${id}/review`) && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Save Correction' }).click()
    expect((await wait).status()).toBe(200)
    await page.getByLabel('Editorial commendation (optional)').fill('Clear reporting with strong sources.')
    const commendation = page.waitForResponse(r => r.url().endsWith('/commendation') && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Save commendation' }).click()
    expect((await commendation).status()).toBe(200)
    for (const [name, endpoint] of [['Featured', 'feature'], ['Pinned', 'pin']]) {
      const button = page.getByRole('button', { name, exact: true })
      const response = page.waitForResponse(r => r.url().endsWith(`/${endpoint}`) && r.request().method() === 'POST')
      await button.click()
      expect((await response).status()).toBe(200)
      await expect(button).toHaveAttribute('aria-pressed', 'true')
    }
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('checkbox', { name: 'Mark as corrected' })).toBeChecked()
    await expect(page.getByPlaceholder('Correction note')).toHaveValue(correction)
    await expect(page.getByLabel('Editorial commendation (optional)')).toHaveValue('Clear reporting with strong sources.')
    const row = (await articleByTitle(title))!
    expect(row).toMatchObject({ corrected: true, correctionNote: correction, isFeatured: true, isPinned: true })
    const anon = await signedIn(browser, null)
    const reader = await anon.newPage()
    expect((await reader.goto(`/articles/${row.slug}`))?.status()).toBe(200)
    await expect(reader.getByText(correction)).toBeVisible()
    await anon.close()
    for (const [name, endpoint] of [['Featured', 'feature'], ['Pinned', 'pin']]) {
      const response = page.waitForResponse(r => r.url().endsWith(`/${endpoint}`) && r.request().method() === 'DELETE')
      await page.getByRole('button', { name, exact: true }).click()
      expect((await response).status()).toBe(200)
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false')
    }
  } finally {
    await db().article.updateMany({ where: { id: { in: featuredBefore.map(a => a.id) } }, data: { isFeatured: true } })
    await ctx.close()
  }
})

test('editor document settings, publish, live link, unpublish and schedule work through their controls', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('settings')
  const slug = title.toLowerCase().replaceAll(' ', '-')
  await ed.title().fill(title)
  await ed.typeBody('Document settings article body.')
  const panel = page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') })
  const status = panel.locator('select').nth(0)
  const author = panel.locator('select').nth(1)
  await expect(author).toBeVisible()
  // Read fixture identity from the options the actual UI loaded.
  const writerOption = await author.locator('option').filter({ hasText: 'Eleanor Hughes' }).getAttribute('value')
  expect(writerOption).toBeTruthy()
  await author.selectOption(writerOption!)
  await panel.getByPlaceholder('url-slug').fill(slug)
  const { id } = await ed.saveNow()
  await ed.openExisting(id)
  await expect(panel.getByPlaceholder('url-slug')).toHaveValue(slug)
  await expect(author).toHaveValue(writerOption!)
  const published = await ed.saving(() => page.getByRole('button', { name: 'Publish', exact: true }).click())
  expect(published.status()).toBe(200)
  expect((await articleByTitle(title))!.status).toBe('PUBLISHED')
  await expect(page.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Reopen to check the live link and persisted status.
  await ed.openExisting(id)
  await expect(status).toHaveValue('PUBLISHED')
  const popup = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'View live' }).click()
  const live = await popup
  await expect(live.locator('h1')).toContainText(title)
  await expect(live.locator('.prose-consilium')).toContainText('Document settings article body.')
  await live.close()
  expect((await ed.saving(() => page.getByRole('button', { name: 'Unpublish', exact: true }).click())).status()).toBe(200)
  const anon = await signedIn(browser, null)
  const publicPage = await anon.newPage()
  expect((await publicPage.goto(`/articles/${slug}`))?.status()).toBe(404)
  await anon.close()
  await status.selectOption('SCHEDULED')
  await panel.locator('input[type="datetime-local"]').fill('2027-01-15T12:30')
  expect((await ed.saving(() => page.getByRole('button', { name: 'Schedule', exact: true }).click())).status()).toBe(200)
  // Reopen in a fresh tab while the original page refreshes its server data.
  // Racing goto against router.refresh in the same WebKit page interrupted it.
  const reopened = await ctx.newPage()
  await new ArticleEditorPage(reopened).openExisting(id)
  const reopenedPanel = reopened.locator('aside', { has: reopened.getByPlaceholder('Add a tag, press Enter...') })
  await expect(reopenedPanel.locator('select').first()).toHaveValue('SCHEDULED')
  await expect(reopenedPanel.locator('input[type="datetime-local"]')).toHaveValue('2027-01-15T12:30')
  const row = (await articleByTitle(title))!
  expect(row.scheduledAt?.toISOString()).toBe('2027-01-15T12:30:00.000Z')
  expect(row.authorId).toBe(writerOption)
  await ctx.close()
})
