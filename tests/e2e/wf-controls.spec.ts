import { test, expect } from '@playwright/test'
import { confirmPublicChange, ArticleEditorPage, articleByTitle, closeDb, db, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'

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

test('review studio links to Manage corrections and the carousel manager; commendation and pin persist', async ({ browser }) => {
  test.setTimeout(90_000) // Several saves, reloads and public pages; per-action deadline remains 10s.
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  try {
    await ed.openNew()
    const title = uniqueTitle('review-controls')
    await ed.title().fill(title)
    await ed.typeBody('A body that is reviewed after publication.')
    const { id } = await ed.saveNow()
    expect((await ed.saving(async () => { await page.getByRole('button', { name: 'Publish', exact: true }).click(); await confirmPublicChange(page, 'Publish now') })).status()).toBe(200)
    await page.goto(`/editorial/review/${id}`, { waitUntil: 'networkidle' })
    // The old checkbox-and-note control is retired: corrections have their own dated, approved workflow.
    await expect(page.getByRole('checkbox', { name: 'Mark as corrected' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Manage corrections' })).toHaveAttribute('href', `/editorial/articles/${id}/corrections`)
    // The single "featured" flag is retired (#163): the homepage carousel is curated in the article editor.
    await expect(page.getByRole('button', { name: 'Featured', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Manage homepage carousel in article editor' })).toHaveAttribute('href', `/editorial/articles/${id}/edit`)
    await page.getByLabel('Editorial commendation (optional)').fill('Clear reporting with strong sources.')
    const commendation = page.waitForResponse(r => r.url().endsWith('/commendation') && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Save commendation' }).click()
    expect((await commendation).status()).toBe(200)
    const pin = page.getByRole('button', { name: 'Pinned', exact: true })
    const pinned = page.waitForResponse(r => r.url().endsWith('/pin') && r.request().method() === 'POST')
    await pin.click()
    expect((await pinned).status()).toBe(200)
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByLabel('Editorial commendation (optional)')).toHaveValue('Clear reporting with strong sources.')
    const row = (await articleByTitle(title))!
    expect(row).toMatchObject({ corrected: false, correctionNote: null, isPinned: true })
    const unpinned = page.waitForResponse(r => r.url().endsWith('/pin') && r.request().method() === 'DELETE')
    await page.getByRole('button', { name: 'Pinned', exact: true }).click()
    expect((await unpinned).status()).toBe(200)
    await expect(page.getByRole('button', { name: 'Pinned', exact: true })).toHaveAttribute('aria-pressed', 'false')
  } finally {
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
  const published = await ed.saving(async () => { await page.getByRole('button', { name: 'Publish', exact: true }).click(); await confirmPublicChange(page, 'Publish now') })
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
  expect((await ed.saving(async () => { await page.getByRole('button', { name: 'Unpublish', exact: true }).click(); await confirmPublicChange(page, 'Unpublish') })).status()).toBe(200)
  const anon = await signedIn(browser, null)
  const publicPage = await anon.newPage()
  expect((await publicPage.goto(`/articles/${slug}`))?.status()).toBe(404)
  await anon.close()
  await status.selectOption('SCHEDULED')
  await panel.locator('input[type="datetime-local"]').fill('2027-01-15T12:30')
  expect((await ed.saving(async () => { await page.getByRole('button', { name: 'Schedule', exact: true }).click(); await confirmPublicChange(page, 'Schedule') })).status()).toBe(200)
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

test('homepage carousel: an editor reorders it, the homepage follows, and the next publication restores newest-first', async ({ browser }) => {
  test.setTimeout(120_000) // Editor, list and homepage navigations; each action keeps its own 10s deadline.
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  const author = await db().user.findFirstOrThrow({ where: { role: 'EDITOR' }, select: { id: true } })
  const previous = await db().siteSetting.findUnique({ where: { key: 'homepage_carousel_v1' } })
  const now = Date.now()
  // Three stories newer than anything published so far, so they form the automatic (newest-first) carousel.
  const [newest, middle, oldest] = await Promise.all([0, 1, 2].map(i => {
    const title = uniqueTitle(`carousel-${i}`)
    return db().article.create({ data: {
      title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), content: 'Carousel fixture body.',
      authorId: author.id, status: 'PUBLISHED', publishedAt: new Date(now - i * 10),
    } })
  }))
  const dot = (position: number, title: string) => page.getByRole('button', { name: `Featured article ${position} of 3: ${title}`, exact: true })
  try {
    await db().siteSetting.deleteMany({ where: { key: 'homepage_carousel_v1' } })
    await page.goto(`/editorial/articles/${newest.id}/edit`, { waitUntil: 'networkidle' })
    const manager = page.getByRole('region', { name: 'Homepage carousel management' }).filter({ visible: true })
    const order = manager.getByRole('list', { name: 'Carousel articles in display order' })
    await expect(order.getByRole('listitem')).toHaveCount(3)
    await expect(order.getByRole('listitem').first()).toContainText(newest.title)
    await manager.getByRole('button', { name: `Move ${newest.title} down`, exact: true }).click()
    await expect(order.getByRole('listitem').first()).toContainText(middle.title)
    const saved = page.waitForResponse(r => r.url().endsWith('/api/editorial/homepage-carousel') && r.request().method() === 'PATCH')
    await manager.getByRole('button', { name: 'Save carousel order', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(manager.getByRole('status')).toContainText('Order saved')

    // A fresh request reflects the saved order: the invalidation reached the cached homepage.
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(dot(1, middle.title)).toBeVisible()
    await expect(dot(2, newest.title)).toBeVisible()
    await expect(dot(3, oldest.title)).toBeVisible()

    // Publishing a newer story expires the manual order: newest-first comes back automatically.
    const latestTitle = uniqueTitle('carousel-latest')
    const latest = await db().article.create({ data: {
      title: latestTitle, slug: latestTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'), content: 'Newest carousel story.',
      authorId: author.id, status: 'DRAFT',
    } })
    await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
    const row = page.getByRole('row').filter({ hasText: latest.title })
    const published = page.waitForResponse(r => r.url().endsWith(`/api/articles/${latest.id}`) && r.request().method() === 'PUT')
    await row.getByRole('button', { name: 'Publish', exact: true }).click()
    await confirmPublicChange(page, 'Publish now')
    expect((await published).status()).toBe(200)
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(dot(1, latest.title)).toBeVisible()
    await expect(dot(2, newest.title)).toBeVisible()
    await expect(dot(3, middle.title)).toBeVisible()
  } finally {
    await db().siteSetting.deleteMany({ where: { key: 'homepage_carousel_v1' } })
    if (previous) await db().siteSetting.create({ data: previous })
    await ctx.close()
  }
})
