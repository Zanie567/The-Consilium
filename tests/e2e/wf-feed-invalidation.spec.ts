import { test, expect, type APIRequestContext } from '@playwright/test'
import { closeDb, createAccount, db, removeMyAccounts, signedIn, type TestAccount } from './helpers/workflow'

/**
 * feed.xml and sitemap.xml on the real production build: warm them, change visibility through the real
 * admin routes, and assert the title and URL are gone from the XML that is served next (and back again on
 * restore). Also pins the response headers, because a CDN-cacheable feed was the original staging defect.
 */
test.describe.configure({ mode: 'serial' })

const run = Date.now().toString(36)
let writer: TestAccount

test.beforeAll(async () => { writer = await createAccount('WRITER', 'feed-writer') })
test.afterAll(async () => {
  const debates = await db().debate.findMany({ where: { title: { startsWith: `WF Feed ${run}` } }, select: { id: true } })
  await db().auditLog.deleteMany({ where: { targetId: { in: debates.map((d) => d.id) } } })
  await db().debate.deleteMany({ where: { id: { in: debates.map((d) => d.id) } } })
  await db().article.deleteMany({ where: { slug: { startsWith: `wf-feed-${run}` } } })
  await removeMyAccounts()
  await closeDb()
})

let n = 0
const mkArticle = (label: string, isDebate = false) => {
  const k = ++n
  return db().article.create({ data: {
    title: `WF Feed ${run} ${label} ${k}`, slug: `wf-feed-${run}-${label}-${k}`, content: '{"type":"doc","content":[{"type":"paragraph"}]}',
    excerpt: 'feed test', authorId: writer.id, status: 'DRAFT', isDebate,
  } })
}
/** Publish through the real admin route, so the caches are expired exactly as in production. */
async function publish(admin: { request: APIRequestContext }, origin: string, id: string) {
  const r = await admin.request.put(`/api/articles/${id}`, { headers: { origin, 'content-type': 'application/json' }, data: { status: 'PUBLISHED', publicationIntent: true } })
  expect(r.ok(), await r.text()).toBe(true)
}
async function xml(request: APIRequestContext, path: '/feed.xml' | '/sitemap.xml') {
  const r = await request.get(path)
  expect(r.status()).toBe(200)
  return { body: await r.text(), headers: r.headers() }
}
async function listed(request: APIRequestContext, a: { slug: string; title: string }) {
  const [f, s] = [await xml(request, '/feed.xml'), await xml(request, '/sitemap.xml')]
  return { feed: f.body.includes(`/articles/${a.slug}`) && f.body.includes(a.title), sitemap: s.body.includes(`/articles/${a.slug}`) }
}

test('feed and sitemap headers forbid shared caching', async ({ request }) => {
  for (const path of ['/feed.xml', '/sitemap.xml'] as const) {
    const { headers } = await xml(request, path)
    const cc = headers['cache-control'] ?? ''
    // Nothing may be kept: no positive max-age or s-maxage, and revalidate on every request.
    expect(cc, path).toMatch(/max-age=0/)
    expect(cc, path).not.toMatch(/(^|[ ,])s?-?max-age=[1-9]\d*/)
    expect(cc, path).not.toMatch(/s-maxage=[1-9]/)
    expect(cc, path).toMatch(/must-revalidate/)
  }
})

test('an article leaves and re-enters both listings as it is trashed and restored', async ({ browser, request }) => {
  const a = await mkArticle('trash')
  expect(await listed(request, a)).toEqual({ feed: false, sitemap: false }) // warms both caches with the draft absent
  const admin = await signedIn(browser, 'admin')
  try {
    // Admin API calls; the origin header satisfies the same-origin guard.
    const origin = new URL((await request.get('/feed.xml')).url()).origin
    const h = { origin, 'content-type': 'application/json' }
    await publish(admin, origin, a.id)
    expect(await listed(request, a)).toEqual({ feed: true, sitemap: true }) // appears at once
    expect(await listed(request, a)).toEqual({ feed: true, sitemap: true }) // and from the warm cache
    expect((await admin.request.delete(`/api/articles/${a.id}`, { headers: h })).ok()).toBe(true)
    expect(await listed(request, a)).toEqual({ feed: false, sitemap: false })
    expect((await admin.request.patch(`/api/editorial/trash/${a.id}`, { headers: h })).ok()).toBe(true)
    expect(await listed(request, a)).toEqual({ feed: true, sitemap: true })
  } finally { await admin.close() }
})

test('both articles of a debate leave and re-enter both listings with the debate lifecycle', async ({ browser, request }) => {
  const [f, g] = [await mkArticle('debate-for', true), await mkArticle('debate-against', true)]
  const debate = await db().debate.create({ data: { title: `WF Feed ${run} debate`, forArticleId: f.id, againstArticleId: g.id, isActive: false } })
  const both = async () => [await listed(request, f), await listed(request, g)]
  const admin = await signedIn(browser, 'admin')
  try {
    const origin = new URL((await request.get('/feed.xml')).url()).origin
    await publish(admin, origin, f.id); await publish(admin, origin, g.id)
    expect(await both()).toEqual([{ feed: true, sitemap: true }, { feed: true, sitemap: true }])
    expect(await both()).toEqual([{ feed: true, sitemap: true }, { feed: true, sitemap: true }]) // warm
    const act = async (action: string, extra: object = {}) => {
      const r = await admin.request.post(`/api/editorial/debates/${debate.id}/lifecycle`, { headers: { origin, 'content-type': 'application/json' }, data: { action, ...extra } })
      expect(r.ok(), `${action}: ${await r.text()}`).toBe(true)
    }
    const GONE = [{ feed: false, sitemap: false }, { feed: false, sitemap: false }]
    const BACK = [{ feed: true, sitemap: true }, { feed: true, sitemap: true }]
    await act('unpublish'); expect(await both()).toEqual(GONE)
    await act('publish'); expect(await both()).toEqual(BACK)
    await act('delete'); expect(await both()).toEqual(GONE)
    await act('restore'); expect(await both()).toEqual(GONE) // restoring never republishes
    await act('publish'); expect(await both()).toEqual(BACK)
  } finally { await admin.close() }
})
