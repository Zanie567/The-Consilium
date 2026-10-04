import { test, expect, type Page } from '@playwright/test'
import {
  confirmPublicChange,
  ArticleEditorPage,
  signedIn,
  uniqueTitle,
  db,
  closeDb,
  removeMyArticles,
} from './helpers/workflow'

async function mutation(
  page: Page,
  path: string,
  method: string,
  status: number,
  act: () => Promise<unknown>
) {
  const waiting = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() === method
  )
  await act()
  const response = await waiting
  expect(response.status(),`${method} ${path}`).toBe(status)
  return method==='POST'?response.json():null
}
test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

test('series creation, cancel and article assignment persist through the enabled controls', async ({
  browser,
}) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('series-article')
  await ed.title().fill(title)
  await ed.typeBody('Series body.')
  const { id } = await ed.saveNow()
  expect(
    (
      await ed.saving(async () => {
        await page.getByRole('button', { name: 'Publish', exact: true }).click()
        await confirmPublicChange(page, 'Publish now')
      })
    ).status()
  ).toBe(200)
  await page.goto('/editorial/series', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New Series' }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByPlaceholder('e.g. UK Housing Policy')).toHaveCount(0)
  await page.getByRole('button', { name: 'New Series' }).click()
  const name = uniqueTitle('series')
  await page.getByPlaceholder('e.g. UK Housing Policy').fill(name)
  await page
    .getByPlaceholder('Brief description (optional)')
    .fill('A series created through its controls.')
  const series = await mutation(page, '/api/editorial/series', 'POST', 201, () =>
    page.getByRole('button', { name: 'Create', exact: true }).click()
  )
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.locator(`#assign-${series.id}`).selectOption(id)
  await mutation(page, `/api/articles/${id}`, 'PUT', 200, () =>
    page.getByRole('button', { name: 'Add', exact: true }).click()
  )
  const reopened = await ctx.newPage()
  await reopened.goto('/editorial/series', { waitUntil: 'networkidle' })
  await reopened.getByRole('button', { name: new RegExp(name) }).click()
  await expect(reopened.getByText(title, { exact: true })).toBeVisible()
  expect(
    await db().article.findUnique({ where: { id }, select: { seriesId: true, seriesOrder: true } })
  ).toEqual({ seriesId: series.id, seriesOrder: 1 })
  await ctx.close()
})

test('glossary creates, edits, searches, toggles, cancels and deletes a term', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const ctx = await signedIn(browser, 'admin')
  const page = await ctx.newPage()
  await page.goto('/editorial/glossary', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const name = uniqueTitle('glossary')
  await page.getByRole('button', { name: 'New term', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'New term', exact: true }).click()
  await page.getByLabel('Term', { exact: true }).fill(name)
  await page.getByLabel('Aliases (comma separated, optional)').fill('WF alias')
  await page
    .getByLabel('Definition', { exact: true })
    .fill('A clear definition used by the workflow test.')
  await page.getByLabel('Learn more URL (optional)').fill('https://example.com/definition')
  const row = await mutation(page, '/api/editorial/glossary', 'POST', 200, () =>
    page.getByRole('button', { name: 'Add term' }).click()
  )
  await page.getByLabel('Search glossary terms').fill(name)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page
    .getByLabel('Definition', { exact: true })
    .fill('The revised definition persists after reopening.')
  await mutation(page, `/api/editorial/glossary/${row.id}`, 'PATCH', 200, () =>
    page.getByRole('button', { name: 'Save changes' }).click()
  )
  await expect(page.getByText('The revised definition persists after reopening.')).toBeVisible()
  for (const label of ['Deactivate', 'Activate'])
    await mutation(page, `/api/editorial/glossary/${row.id}`, 'PATCH', 200, () =>
      page.getByRole('button', { name: label, exact: true }).last().click()
    )
  const linking = page.getByRole('switch', { name: 'Term linking on articles' })
  const initial = await linking.getAttribute('aria-checked')
  await mutation(page, '/api/editorial/glossary/settings', 'PATCH', 200, () => linking.click())
  await expect(linking).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
  await mutation(page, '/api/editorial/glossary/settings', 'PATCH', 200, () => linking.click())
  page.once('dialog', (d) => void d.dismiss())
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await mutation(page, `/api/editorial/glossary/${row.id}`, 'DELETE', 200, () =>
    page.getByRole('button', { name: `Delete ${name}` }).click()
  )
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0)
  await ctx.close()
})

test('dashboard commissioning and writer cadence save and reopen for separate roles', async ({
  browser,
}) => {
  const growth = await signedIn(browser, 'growth')
  const gp = await growth.newPage()
  await gp.goto('/editorial', { waitUntil: 'networkidle' })
  const brief = uniqueTitle('commissioning')
  await gp.getByLabel('Commissioning brief').fill(brief)
  await mutation(gp, '/api/editorial/commissioning-brief', 'PATCH', 200, () =>
    gp.getByRole('button', { name: 'Save brief' }).click()
  )
  await gp.reload({ waitUntil: 'networkidle' })
  await expect(gp.getByLabel('Commissioning brief')).toHaveValue(brief)
  const writer = await signedIn(browser, 'writer')
  const wp = await writer.newPage()
  await wp.goto('/editorial', { waitUntil: 'networkidle' })
  await expect(wp.getByText(brief, { exact: true })).toBeVisible()
  await expect(wp.getByLabel('Commissioning brief')).toHaveCount(0)
  await mutation(wp, '/api/user/streak', 'PATCH', 200, () =>
    wp.getByLabel('Streak cadence').selectOption('2')
  )
  await wp.reload({ waitUntil: 'networkidle' })
  await expect(wp.getByLabel('Streak cadence')).toHaveValue('2')
  await growth.close()
  await writer.close()
})

test('inline review comments are created, replied to, resolved and reopened by separate editor/writer sessions', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const writer = await signedIn(browser, 'writer')
  const wp = await writer.newPage()
  const ed = new ArticleEditorPage(wp)
  await ed.openNew()
  await ed.title().fill(uniqueTitle('inline'))
  await ed.typeBody('This sentence needs a source. Another sentence.')
  const { id } = await ed.saveNow()
  expect(
    (
      await ed.saving(() => wp.getByRole('button', { name: 'Submit', exact: true }).click())
    ).status()
  ).toBe(200)
  const editor = await signedIn(browser, 'editor')
  const ep = await editor.newPage()
  await ep.goto(`/editorial/review/${id}`, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(ep).dismissCookieBanner()
  await ep
    .locator('.ProseMirror')
    .getByText('This sentence needs a source.', { exact: false })
    .click()
  await new ArticleEditorPage(ep).select('This sentence needs a source.')
  await ep.getByRole('button', { name: 'Add comment', exact: true }).click()
  await ep.getByPlaceholder('Add a comment...').fill('Please provide the source for this sentence.')
  await mutation(ep, `/api/articles/${id}/comments`, 'POST', 201, () =>
    ep.getByRole('button', { name: 'Add comment', exact: true }).click()
  )
  await wp.reload({ waitUntil: 'networkidle' })
  await expect(wp.getByText('Please provide the source for this sentence.').filter({visible:true})).toBeVisible()
  await wp.getByRole('button', { name: 'Reply', exact: true }).filter({ visible: true }).click()
  await wp.getByPlaceholder('Reply...').filter({visible:true}).fill('Source added in my revision.')
  await mutation(wp, `/api/articles/${id}/comments`, 'POST', 201, () =>
    wp.getByRole('button', { name: 'Post', exact: true }).filter({visible:true}).click()
  )
  await ep.reload({ waitUntil: 'networkidle' })
  await expect(ep.getByText('Source added in my revision.').filter({visible:true})).toBeVisible()
  const thread = await db().articleComment.findFirstOrThrow({
    where: { articleId: id, parentId: null },
  })
  await mutation(ep, `/api/articles/${id}/comments/${thread.id}`, 'PATCH', 200, () =>
    ep.getByRole('button', { name: 'Resolve', exact: true }).filter({visible:true}).click()
  )
  await expect
    .poll(
      async () =>
        await db().articleComment.count({
          where: { articleId: id, parentId: null, resolved: true },
        })
    )
    .toBe(1)
  await ep.getByRole('button', { name: /Show 1 resolved/ }).filter({ visible: true }).click()
  await mutation(ep, `/api/articles/${id}/comments/${thread.id}`, 'PATCH', 200, () =>
    ep.getByRole('button', { name: 'Reopen', exact: true }).filter({visible:true}).click()
  )
  await expect
    .poll(
      async () =>
        await db().articleComment.count({
          where: { articleId: id, parentId: null, resolved: false },
        })
    )
    .toBe(1)
  await editor.close()
  await writer.close()
})

test('Admin prediction create, edit, vote, revise, close, reopen, resolve and cancel follow permissions', async ({
  browser,
}) => {
  test.setTimeout(120_000) // Distinct state transitions with per-action deadlines unchanged.
  const ctx = await signedIn(browser, 'admin')
  const page = await ctx.newPage()
  const name = uniqueTitle('prediction')
  await page.goto('/editorial/predictions/new', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.getByLabel('Title', { exact: true }).fill(name)
  await page.getByLabel('Type', { exact: true }).selectOption('OTHER')
  await page.getByLabel('FRED series id (optional)').fill('')
  await page.getByLabel('Unit label', { exact: true }).fill('%')
  await page.getByLabel('Min value', { exact: true }).fill('0')
  await page.getByLabel('Max value', { exact: true }).fill('10')
  await page.getByLabel('Max error', { exact: true }).fill('5')
  await page.getByLabel('Submission deadline').fill('2027-02-15T12:00')
  await page.getByLabel('Expected release').fill('2027-02-16T12:00')
  const created = await mutation(page, '/api/editorial/predictions', 'POST', 200, () =>
    page.getByRole('button', { name: 'Create event' }).click()
  )
  const id = created.id
  await page.waitForURL('**/editorial/predictions')
  const card = page
    .locator('div')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .filter({ has: page.getByRole('link', { name: 'Edit', exact: true }) })
    .last()
  await card.getByRole('link', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Description (optional)').fill('Workflow prediction revised.')
  await mutation(page, `/api/editorial/predictions/${id}`, 'PATCH', 200, () =>
    page.getByRole('button', { name: 'Save changes' }).click()
  )
  await page.waitForURL('**/editorial/predictions')
  await page.getByRole('link', { name, exact: true }).click()
  await page.getByLabel('Your prediction').fill('4.25')
  await mutation(page, `/api/predictions/${id}`, 'POST', 200, () =>
    page.getByRole('button', { name: 'Submit prediction' }).click()
  )
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByLabel('Your prediction')).toHaveValue('4.25')
  await page.getByLabel('Your prediction').fill('4.5')
  await mutation(page, `/api/predictions/${id}`, 'POST', 200, () =>
    page.getByRole('button', { name: 'Update prediction' }).click()
  )
  await page.goto('/editorial/predictions', { waitUntil: 'networkidle' })
  await mutation(page, `/api/editorial/predictions/${id}`, 'PATCH', 200, () =>
    card.getByRole('button', { name: 'Close early' }).click()
  )
  await expect(card.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
  await mutation(page, `/api/editorial/predictions/${id}`, 'PATCH', 200, () =>
    card.getByRole('button', { name: 'Reopen', exact: true }).click()
  )
  await card.getByRole('button', { name: 'Resolve manually' }).click()
  await card.getByPlaceholder('Actual (%)').fill('4.5')
  page.once('dialog', (d) => void d.dismiss())
  await card.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await mutation(page, `/api/editorial/predictions/${id}`, 'PATCH', 200, () =>
    card.getByRole('button', { name: 'Resolve', exact: true }).click()
  )
  expect((await db().predictionEvent.findUnique({ where: { id } }))!.status).toBe('RESOLVED')
  // Separate open fixture: cancellation is exercised through its actual irreversible control.
  const cancelled = await db().predictionEvent.create({
    data: {
      semesterKey: '2026-27-S2',
      createdById: (await db().user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id,
      title: uniqueTitle('cancel-event'),
      type: 'OTHER',
      unitLabel: '%',
      deadline: new Date('2027-02-15'),
      releaseDate: new Date('2027-02-16'),
      minValue: 0,
      maxValue: 10,
      maxError: 5,
    },
  })
  await page.reload({ waitUntil: 'networkidle' })
  const cancelCard = page
    .locator('div')
    .filter({ has: page.getByRole('link', { name: cancelled.title, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Cancel event' }) })
    .last()
  page.once('dialog', (d) => void d.accept())
  await mutation(page, `/api/editorial/predictions/${cancelled.id}`, 'PATCH', 200, () =>
    cancelCard.getByRole('button', { name: 'Cancel event' }).click()
  )
  expect((await db().predictionEvent.findUnique({ where: { id: cancelled.id } }))!.status).toBe(
    'CANCELLED'
  )
  await ctx.close()
})

test('calendar month navigation, day details and article links exercise real controls', async ({
  browser,
}) => {
  const ctx = await signedIn(browser, 'admin')
  const page = await ctx.newPage()
  await page.goto('/editorial/calendar?month=2026-11', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.getByRole('link', { name: 'Go to December 2026' }).click()
  await expect(page).toHaveURL(/month=2026-12/)
  await page.getByRole('link', { name: 'Go to November 2026' }).click()
  await expect(page).toHaveURL(/month=2026-11/)
  await page
    .getByRole('button', { name: /nothing planned/ })
    .first()
    .click()
  await expect(page.getByRole('dialog', { name: /Details for/ })).toBeVisible()
  await expect(page.getByText('Nothing scheduled or published on this day.')).toBeVisible()
  await page.getByLabel('Close day details').click()
  await expect(page.getByRole('dialog', { name: /Details for/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page).toHaveURL(/\/editorial\/calendar$/)
  await ctx.close()
})

test('Growth analytics requests exact date ranges and every tab through the UI', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const ctx = await signedIn(browser, 'growth')
  const page = await ctx.newPage()
  await page.goto('/editorial/analytics', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  let current = 'Last 30 days'
  for (const [label, value] of [
    ['Last 24 hours', '24h'],
    ['Last 7 days', '7d'],
    ['Last 90 days', '90d'],
    ['Last 30 days', '30d'],
  ]) {
    await page.getByRole('button', { name: current, exact: true }).first().click()
    const request = page.waitForResponse((r) =>
      r.url().includes(`/api/editorial/analytics?period=${value}&tab=overview`)
    )
    await page.getByRole('button', { name: label, exact: true }).last().click()
    expect((await request).status()).toBe(200)
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(1)
    current = label
  }
  for (const [label, tab] of [
    ['Content', 'content'],
    ['Audience', 'audience'],
    ['Engagement', 'engagement'],
    ['Writers', 'leaderboard'],
    ['Distribution', 'distribution'],
  ]) {
    const response = page.waitForResponse((r) =>
      r.url().includes(`/api/editorial/analytics?period=30d&tab=${tab}`)
    )
    await page.getByRole('button', { name: label, exact: true }).last().click()
    expect((await response).status()).toBe(200)
  }
  await ctx.close()
})
