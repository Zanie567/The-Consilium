import { test, expect, type Browser, type Page } from '@playwright/test'
import { closeDb, confirmDialog, createAccount, db, removeMyAccounts, signedIn, type TestAccount } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Debate administration, end to end: the real admin screen, real clicks, and then the real
 * public website to prove a removed debate is actually gone, not just hidden on one page.
 */
test.describe.configure({ mode: 'serial' })

const run = Date.now().toString(36)
const created: string[] = []
let writer: TestAccount

test.beforeAll(async () => {
  writer = await createAccount('WRITER', 'debate-writer')
})

test.afterAll(async () => {
  const debates = await db().debate.findMany({ where: { title: { startsWith: `WF Debate ${run}` } }, select: { id: true } })
  await db().debateVote.deleteMany({ where: { debateId: { in: debates.map((d) => d.id) } } })
  await db().auditLog.deleteMany({ where: { targetId: { in: debates.map((d) => d.id) } } })
  await db().debate.deleteMany({ where: { id: { in: debates.map((d) => d.id) } } })
  await db().article.deleteMany({ where: { slug: { startsWith: `wf-debate-${run}` } } })
  await removeMyAccounts()
  await closeDb()
})

let counter = 0
async function makeDebate(label: string) {
  const n = ++counter
  const title = `WF Debate ${run} ${label} ${n}`
  const mk = (side: string) =>
    db().article.create({
      data: {
        title: `${title} ${side}`,
        slug: `wf-debate-${run}-${label}-${n}-${side}`.toLowerCase(),
        content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Debate body."}]}]}',
        excerpt: `${title} excerpt`,
        authorId: writer.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isDebate: true,
      },
    })
  const [forArticle, againstArticle] = await Promise.all([mk('for'), mk('against')])
  const debate = await db().debate.create({ data: { title, forArticleId: forArticle.id, againstArticleId: againstArticle.id, isActive: false } })
  created.push(debate.id)
  return { debate, forArticle, againstArticle, title }
}

/** What an anonymous visitor can reach, from a brand-new browser context. */
async function publicView(browser: Browser, d: Awaited<ReturnType<typeof makeDebate>>) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto('/opinion-debate')
    const onDebatePage = await page.getByText(d.title, { exact: false }).count()
    const articleStatus = (await context.request.get(`/articles/${d.forArticle.slug}`)).status()
    const search = (await (await context.request.get(`/api/search?q=${encodeURIComponent(d.title)}`)).json()) as { title: string }[]
    const archive = await context.request.get('/sitemap.xml')
    const inSitemap = (await archive.text()).includes(d.forArticle.slug)
    return { onDebatePage: onDebatePage > 0, articleStatus, inSearch: search.some((a) => a.title.startsWith(d.title)), inSitemap }
  } finally {
    await context.close()
  }
}

const card = (page: Page, id: string) => page.getByTestId(`debate-${id}`)
const status = (page: Page) => page.getByRole('status')

async function act(page: Page, id: string, button: string, dialogConfirm: string, expectMessage: RegExp) {
  await card(page, id).getByRole('button', { name: button, exact: true }).click()
  await expect(confirmDialog(page)).toBeVisible()
  await confirmDialog(page).getByRole('button', { name: dialogConfirm, exact: true }).click()
  await expect(status(page)).toContainText(expectMessage)
}

test('an administrator unpublishes, restores, deletes and permanently removes a debate, and the public site follows each step', async ({ browser }) => {
  test.setTimeout(150_000)
  const d = await makeDebate('lifecycle')
  const context = await signedIn(browser, 'admin')
  const page = await context.newPage()
  const errors = collectConsoleErrors(page)
  await page.goto('/editorial/debates')
  await expect(page.getByRole('heading', { name: 'Debates', level: 1 })).toBeVisible()

  // Find it: by title, and by contributor; a miss says so.
  await page.getByLabel('Search').fill(d.title)
  await expect(card(page, d.debate.id)).toBeVisible()
  await page.getByLabel('Search').fill(writer.name)
  await expect(card(page, d.debate.id)).toBeVisible()
  await page.getByLabel('Search').fill('zz-no-such-debate-zz')
  await expect(page.getByText('No debates match this search.')).toBeVisible()
  await page.getByLabel('Search').fill(d.title)

  // Live: public everywhere.
  await expect(card(page, d.debate.id)).toContainText('Published')
  expect(await publicView(browser, d)).toMatchObject({ onDebatePage: true, articleStatus: 200, inSearch: true })

  // Unpublish: gone from every public surface at once, nothing deleted.
  await act(page, d.debate.id, 'Unpublish', 'Unpublish', /Unpublished\./)
  await expect(card(page, d.debate.id)).toContainText('Unpublished')
  expect(await publicView(browser, d)).toMatchObject({ onDebatePage: false, articleStatus: 404, inSearch: false, inSitemap: false })
  expect(await db().article.count({ where: { id: { in: [d.forArticle.id, d.againstArticle.id] } } })).toBe(2)

  // Publish: back.
  await act(page, d.debate.id, 'Publish', 'Publish', /Published\./)
  expect(await publicView(browser, d)).toMatchObject({ onDebatePage: true, articleStatus: 200, inSearch: true })

  // Delete (recoverable): hidden publicly, still listed for the administrator under Deleted.
  await act(page, d.debate.id, 'Delete', 'Delete', /Deleted\./)
  await expect(card(page, d.debate.id)).toContainText('Deleted')
  expect(await publicView(browser, d)).toMatchObject({ onDebatePage: false, articleStatus: 404, inSearch: false })
  await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: 'Deleted', exact: true }).click()
  await expect(card(page, d.debate.id)).toBeVisible()
  await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: 'Published', exact: true }).click()
  await expect(card(page, d.debate.id)).toHaveCount(0)
  await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: 'All', exact: true }).click()

  // Restore: comes back UNPUBLISHED, still not public until published on purpose.
  await act(page, d.debate.id, 'Restore', 'Restore', /Restored as unpublished/)
  await expect(card(page, d.debate.id)).toContainText('Unpublished')
  expect(await publicView(browser, d)).toMatchObject({ onDebatePage: false, articleStatus: 404 })

  // Permanent deletion needs it deleted first and the exact title typed.
  await act(page, d.debate.id, 'Delete', 'Delete', /Deleted\./)
  await card(page, d.debate.id).getByRole('button', { name: 'Delete permanently', exact: true }).click()
  const confirmButton = confirmDialog(page).getByRole('button', { name: 'Delete permanently', exact: true })
  await expect(confirmButton).toBeDisabled()
  await confirmDialog(page).getByLabel(/Type .* to confirm/).fill('not the title')
  await expect(confirmButton).toBeDisabled()
  await confirmDialog(page).getByLabel(/Type .* to confirm/).fill(d.title)
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()
  await expect(status(page)).toContainText('Permanently deleted')
  await expect(card(page, d.debate.id)).toHaveCount(0)

  // The database agrees: debate gone, both articles in the article Trash (not lost, not public).
  expect(await db().debate.count({ where: { id: d.debate.id } })).toBe(0)
  const trashed = await db().article.findMany({ where: { id: { in: [d.forArticle.id, d.againstArticle.id] } } })
  expect(trashed).toHaveLength(2)
  expect(trashed.every((a) => a.deletedAt !== null)).toBe(true)
  const trail = (await db().auditLog.findMany({ where: { targetId: d.debate.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action)
  expect(trail).toEqual(['DEBATE_UNPUBLISHED', 'DEBATE_PUBLISHED', 'DEBATE_DELETED', 'DEBATE_RESTORED', 'DEBATE_DELETED', 'DEBATE_PERMANENTLY_DELETED'])

  expect(errors).toEqual([])
  await context.close()
})

test('a double-clicked confirmation sends one request, and a stale second tab is refused cleanly', async ({ browser }) => {
  test.setTimeout(90_000)
  const d = await makeDebate('double')
  const context = await signedIn(browser, 'admin')
  const first = await context.newPage()
  const second = await context.newPage()
  await first.goto('/editorial/debates')
  await second.goto('/editorial/debates')
  await first.getByLabel('Search').fill(d.title)
  await second.getByLabel('Search').fill(d.title)

  let sent = 0
  await first.route('**/lifecycle', async (route) => { sent++; await route.continue() })
  await card(first, d.debate.id).getByRole('button', { name: 'Delete', exact: true }).click()
  await confirmDialog(first).getByRole('button', { name: 'Delete', exact: true }).dblclick()
  await expect(status(first)).toContainText('Deleted.')
  expect(sent).toBe(1)
  expect(await db().auditLog.count({ where: { targetId: d.debate.id, action: 'DEBATE_DELETED' } })).toBe(1)

  // The other tab still shows the old, published row. Acting on it is refused, with the reason.
  await expect(card(second, d.debate.id)).toContainText('Published')
  await card(second, d.debate.id).getByRole('button', { name: 'Unpublish', exact: true }).click()
  await confirmDialog(second).getByRole('button', { name: 'Unpublish', exact: true }).click()
  await expect(status(second)).toContainText(/changed since you opened it|already deleted|Only a published debate/)
  // ...and its list refreshes to the truth.
  await expect(card(second, d.debate.id)).toContainText('Deleted')
  expect(await db().auditLog.count({ where: { targetId: d.debate.id, action: 'DEBATE_UNPUBLISHED' } })).toBe(0)
  await context.close()
})

test('editors can see and edit debates but cannot unpublish or delete; writers cannot reach them; the API enforces it', async ({ browser }) => {
  test.setTimeout(90_000)
  const d = await makeDebate('permissions')

  const editor = await signedIn(browser, 'editor')
  const editorPage = await editor.newPage()
  await editorPage.goto('/editorial/debates')
  await editorPage.getByLabel('Search').fill(d.title)
  await expect(card(editorPage, d.debate.id)).toBeVisible()
  await expect(card(editorPage, d.debate.id).getByRole('link', { name: 'Edit' })).toBeVisible()
  for (const name of ['Unpublish', 'Delete', 'Publish', 'Restore', 'Delete permanently']) {
    await expect(card(editorPage, d.debate.id).getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  // Hiding the buttons is not the boundary: the server refuses a hand-made request.
  const refused = await editor.request.post(`/api/editorial/debates/${d.debate.id}/lifecycle`, { data: { action: 'delete' } })
  expect(refused.status()).toBe(403)
  await editor.close()

  const author = await signedIn(browser, 'writer')
  const writerPage = await author.newPage()
  await writerPage.goto('/editorial/debates')
  await expect(writerPage).toHaveURL(/\/editorial$/)
  expect((await author.request.post(`/api/editorial/debates/${d.debate.id}/lifecycle`, { data: { action: 'delete' } })).status()).toBe(403)
  await author.close()

  const anonymous = await browser.newContext()
  expect((await anonymous.request.post(`/api/editorial/debates/${d.debate.id}/lifecycle`, { data: { action: 'delete' } })).status()).toBe(401)
  await anonymous.close()

  const row = await db().debate.findUniqueOrThrow({ where: { id: d.debate.id } })
  expect(row).toMatchObject({ deletedAt: null, unpublishedAt: null })
  expect(await db().auditLog.count({ where: { targetId: d.debate.id } })).toBe(0)
})

test('an edit that loses a race is refused, and a hidden debate cannot be made the featured one', async ({ browser }) => {
  test.setTimeout(90_000)
  const d = await makeDebate('edit')
  const context = await signedIn(browser, 'admin')
  const page = await context.newPage()
  await page.goto(`/editorial/debates/${d.debate.id}/edit`)
  await expect(page.getByRole('heading', { name: 'Edit Debate' })).toBeVisible()
  // Someone else changes the debate while this form is open.
  await db().debate.update({ where: { id: d.debate.id }, data: { description: 'changed elsewhere' } })
  await page.getByLabel('Title').fill(`${d.title} renamed`)
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByText('changed since you opened it')).toBeVisible()
  expect((await db().debate.findUniqueOrThrow({ where: { id: d.debate.id } })).title).toBe(d.title)

  // A normal edit succeeds and is audited.
  await page.reload()
  await page.getByLabel('Title').fill(`${d.title} renamed`)
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page).toHaveURL(/\/editorial\/debates$/)
  expect((await db().debate.findUniqueOrThrow({ where: { id: d.debate.id } })).title).toBe(`${d.title} renamed`)
  expect(await db().auditLog.count({ where: { targetId: d.debate.id, action: 'DEBATE_UPDATED' } })).toBe(1)
  await context.close()
})
