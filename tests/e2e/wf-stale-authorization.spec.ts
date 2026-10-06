import { test, expect, type BrowserContext } from '@playwright/test'
import { closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signInAs, signedIn, uniqueTitle, type TestAccount } from './helpers/workflow'

/**
 * Stale session vs stale AUTHORISATION. The signed session cookie (a JWT) caches the role, ban and
 * active flags and refreshes them from the database at most once a minute. That is harmless for
 * navigation chrome, but not if a page reads protected data straight from the database after trusting
 * the cached role. So: sign in as a real account, change it the way an admin would, and IMMEDIATELY
 * (inside the cache window) request protected server-rendered pages with the old cookie. Protected
 * content must never appear in the response.
 */
test.afterAll(async () => {
  await removeMyArticles()
  await removeMyAccounts()
  await closeDb()
})

const stamp = Date.now().toString(36)
const MARK = `STALEMARK${stamp}`

/** Pages that render protected data on the server, by who may see them. */
const PAGES = {
  editorial: ['/editorial/review', '/editorial/articles', '/editorial/trash', '/editorial/scheduled', '/editorial/series', '/editorial/debates', '/editorial'],
  article: ['/editorial/review/{pending}', '/editorial/articles/{pending}/edit', '/editorial/articles/{draft}/edit'],
  admin: ['/editorial/users', '/editorial/calendar', '/editorial/analytics', '/editorial/glossary', '/editorial/predictions', '/admin', '/admin/articles', '/admin/subscribers', '/admin/data', '/admin/team'],
  growth: ['/editorial/growth/subscribers', '/editorial/growth/engagement', '/editorial/growth/writer-activity'],
}

let pending = ''
let draft = ''

test.beforeAll(async () => {
  const author = await createAccount('WRITER', 'stale-author')
  const mk = (label: string, status: 'PENDING_REVIEW' | 'DRAFT') =>
    db().article.create({
      data: {
        title: `${uniqueTitle(label)} ${MARK}`, slug: `wf-${label}-${stamp}`, authorId: author.id, status,
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `body ${MARK} ${label}` }] }] }),
      },
    })
  pending = (await mk('pending', 'PENDING_REVIEW')).id
  draft = (await mk('draft', 'DRAFT')).id
})

async function leaks(ctx: BrowserContext, urls: string[]) {
  const found: string[] = []
  for (const template of urls) {
    const url = template.replace('{pending}', pending).replace('{draft}', draft)
    const res = await ctx.request.get(url, { maxRedirects: 0, failOnStatusCode: false })
    const body = res.status() === 200 ? await res.text() : ''
    if (body.includes(MARK)) found.push(`${url} -> ${res.status()} contains protected content`)
  }
  return found
}

/** Signs in, proves the probe CAN see the markers, applies `change`, then probes immediately. */
async function scenario(browser: import('@playwright/test').Browser, account: TestAccount, canSee: string[], change: () => Promise<unknown>, probe: string[]) {
  const ctx = await signInAs(browser, account)
  for (const url of canSee) {
    const res = await ctx.request.get(url.replace('{pending}', pending), { maxRedirects: 0, failOnStatusCode: false })
    expect(res.status(), `control: ${url} should render for a ${account.role} before the change`).toBe(200)
    expect(await res.text(), `control: ${url} shows the marker`).toContain(MARK)
  }
  await change()
  const found = await leaks(ctx, probe)
  await ctx.close()
  return found
}

const all = [...PAGES.editorial, ...PAGES.article, ...PAGES.admin, ...PAGES.growth]

test.describe('a changed account gets no protected server-rendered data from its old cookie', () => {
  test('editor demoted to reader', async ({ browser }) => {
    const a = await createAccount('EDITOR', 'dem-reader')
    expect(await scenario(browser, a, ['/editorial/review', '/editorial/review/{pending}'], () => db().user.update({ where: { id: a.id }, data: { role: 'READER' } }), all)).toEqual([])
  })

  test('editor demoted to writer', async ({ browser }) => {
    const a = await createAccount('EDITOR', 'dem-writer')
    expect(await scenario(browser, a, ['/editorial/review', '/editorial/review/{pending}'], () => db().user.update({ where: { id: a.id }, data: { role: 'WRITER' } }), all)).toEqual([])
  })

  test('editor banned', async ({ browser }) => {
    const a = await createAccount('EDITOR', 'banned')
    expect(await scenario(browser, a, ['/editorial/review', '/editorial/review/{pending}'], () => db().user.update({ where: { id: a.id }, data: { isBanned: true } }), all)).toEqual([])
  })

  test('editor deactivated', async ({ browser }) => {
    const a = await createAccount('EDITOR', 'inactive')
    expect(await scenario(browser, a, ['/editorial/review', '/editorial/review/{pending}'], () => db().user.update({ where: { id: a.id }, data: { isActive: false } }), all)).toEqual([])
  })

  test('editor whose account was deleted', async ({ browser }) => {
    const a = await createAccount('EDITOR', 'deleted')
    expect(await scenario(browser, a, ['/editorial/review', '/editorial/review/{pending}'], () => db().user.delete({ where: { id: a.id } }), all)).toEqual([])
  })

  test('admin demoted to writer', async ({ browser }) => {
    const a = await createAccount('ADMIN', 'dem-admin')
    expect(await scenario(browser, a, ['/editorial/review/{pending}'], () => db().user.update({ where: { id: a.id }, data: { role: 'WRITER' } }), [...PAGES.admin, ...PAGES.editorial, ...PAGES.article])).toEqual([])
  })

  test('admin banned', async ({ browser }) => {
    const a = await createAccount('ADMIN', 'ban-admin')
    expect(await scenario(browser, a, ['/editorial/review/{pending}'], () => db().user.update({ where: { id: a.id }, data: { isBanned: true } }), all)).toEqual([])
  })

  test('writer banned cannot keep reading the portal', async ({ browser }) => {
    const a = await createAccount('WRITER', 'ban-writer')
    const own = await db().article.create({
      data: { title: `${uniqueTitle('own')} ${MARK}`, slug: `wf-own-${Date.now().toString(36)}`, authorId: a.id, status: 'DRAFT', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: MARK }] }] }) },
    })
    const ctx = await signInAs(browser, a)
    const before = await ctx.request.get(`/editorial/articles/${own.id}/edit`, { maxRedirects: 0, failOnStatusCode: false })
    expect(before.status()).toBe(200)
    await db().user.update({ where: { id: a.id }, data: { isBanned: true } })
    const after = await ctx.request.get(`/editorial/articles/${own.id}/edit`, { maxRedirects: 0, failOnStatusCode: false })
    const body = after.status() === 200 ? await after.text() : ''
    expect(body, 'a banned writer is shown their article').not.toContain(MARK)
    await ctx.close()
  })

  test('growth demoted to reader gets no analytics or subscriber pages', async ({ browser }) => {
    const a = await createAccount('GROWTH', 'dem-growth')
    const ctx = await signInAs(browser, a)
    const ok = await ctx.request.get('/editorial/analytics', { maxRedirects: 0, failOnStatusCode: false })
    expect(ok.status()).toBe(200)
    await db().user.update({ where: { id: a.id }, data: { role: 'READER' } })
    for (const url of ['/editorial/analytics', '/editorial/growth/engagement', '/editorial/growth/subscribers', '/editorial/growth/writer-activity']) {
      const res = await ctx.request.get(url, { maxRedirects: 0, failOnStatusCode: false })
      const text = res.status() === 200 ? await res.text() : ''
      // A 200 is acceptable only if it is the Access Denied shell, never the page.
      expect(text.includes('Access Denied') || res.status() !== 200, `${url} rendered for a demoted account (${res.status()})`).toBe(true)
    }
    await ctx.close()
  })
})

test.describe('accounts that never had access get no protected server-rendered data either', () => {
  // The portal layout shows "Access Denied" to a reader, but the page under it used to run anyway
  // and its data was serialised into the response. Checked with the real seeded reader and growth.
  for (const who of ['reader', 'growth'] as const) {
    test(`${who} receives no draft, pending or review content`, async ({ browser }) => {
      const ctx = await signedIn(browser, who)
      const urls = [...PAGES.editorial, ...PAGES.article, ...(who === 'reader' ? PAGES.growth : [])]
      expect(await leaks(ctx, urls)).toEqual([])
      await ctx.close()
    })
  }
})
