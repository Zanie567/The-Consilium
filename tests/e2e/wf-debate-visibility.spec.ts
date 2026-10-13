import { test, expect, type APIRequestContext } from '@playwright/test'
import { closeDb, createAccount, db, removeMyAccounts, signedIn, type TestAccount } from './helpers/workflow'

/**
 * A published debate whose argument an editor archived or trashed on its own must disappear from the public site.
 * This runs against the REAL production build, so it sees what no in-process test can: the server-rendered HTML AND the
 * Next.js Flight (RSC) payload that carries the same props to the browser, the JSON API, and the article URL.
 * The changes are made through the real editorial routes, and the debate must come back after a legitimate
 * republication or restore, without anything being republished on a read.
 *
 * (The full state matrix, voting, history/statistics and the race tests are in
 * tests/integration/debate-public-visibility-db.test.ts, against the same schema.)
 */
test.describe.configure({ mode: 'serial' })

const run = Date.now().toString(36)
let writer: TestAccount
let reactivate: string[] = []

test.beforeAll(async () => { writer = await createAccount('WRITER', 'debate-vis-writer') })
test.afterAll(async () => {
  const debates = await db().debate.findMany({ where: { title: { startsWith: `WF DebVis ${run}` } }, select: { id: true } })
  await db().debateVote.deleteMany({ where: { debateId: { in: debates.map((d) => d.id) } } })
  await db().auditLog.deleteMany({ where: { targetId: { in: debates.map((d) => d.id) } } })
  await db().debate.deleteMany({ where: { id: { in: debates.map((d) => d.id) } } })
  await db().debate.updateMany({ where: { id: { in: reactivate } }, data: { isActive: true } })
  await db().article.deleteMany({ where: { slug: { startsWith: `wf-debvis-${run}` } } })
  await removeMyAccounts()
  await closeDb()
})

const mk = (side: 'for' | 'against') => db().article.create({ data: {
  title: `WF DebVis ${run} ${side} headline`, slug: `wf-debvis-${run}-${side}`, content: '{"type":"doc","content":[{"type":"paragraph"}]}',
  excerpt: `WF DebVis ${run} ${side} excerpt`, authorId: writer.id, status: 'PUBLISHED', publishedAt: new Date(), isDebate: true,
} })

/** Everything a visitor can receive about the debate: page HTML, the Flight payload, the home page, the API. */
async function served(request: APIRequestContext) {
  const html = await (await request.get('/opinion-debate')).text()
  const flight = await (await request.get('/opinion-debate', { headers: { RSC: '1', 'Next-Url': '/opinion-debate' } })).text()
  const home = await (await request.get('/')).text()
  const active = await (await request.get('/api/debates/active')).text()
  return { html, flight, home, active }
}
const SECRETS = (side: 'for' | 'against') => [`WF DebVis ${run} ${side} headline`, `WF DebVis ${run} ${side} excerpt`, `wf-debvis-${run}-${side}`]

test('an argument archived, then trashed, takes the whole debate off every public rendering; republishing and restoring bring it back', async ({ browser, request }) => {
  const [f, a] = [await mk('for'), await mk('against')]
  const debate = await db().debate.create({ data: { title: `WF DebVis ${run} debate`, description: `WF DebVis ${run} description`, forArticleId: f.id, againstArticleId: a.id, isActive: true } })
  // The homepage and /api/debates/active show "the" active debate: make ours the only one, restore afterwards.
  reactivate = (await db().debate.findMany({ where: { isActive: true, id: { not: debate.id } }, select: { id: true } })).map((d) => d.id)
  await db().debate.updateMany({ where: { id: { in: reactivate } }, data: { isActive: false } })

  const admin = await signedIn(browser, 'admin')
  try {
    const origin = new URL((await request.get('/feed.xml')).url()).origin
    const h = { origin, 'content-type': 'application/json' }
    const everything = (s: Awaited<ReturnType<typeof served>>) => [s.html, s.flight, s.home, s.active].join('\n')

    // Public: both sides appear in the HTML and in the Flight payload, and the API answers.
    const open = await served(request)
    for (const side of ['for', 'against'] as const) for (const x of SECRETS(side).slice(0, 2)) {
      expect(open.html, x).toContain(x)
      expect(open.flight, `flight: ${x}`).toContain(x)
    }
    expect(open.active).toContain(`WF DebVis ${run} debate`)
    expect(open.home).toContain(`WF DebVis ${run} debate`)

    const expectAbsent = async (why: string, brokenSide: 'for' | 'against') => {
      const s = await served(request)
      const body = everything(s)
      for (const side of ['for', 'against'] as const) for (const x of SECRETS(side)) {
        // The homepage lists ordinary articles too, so a side that is still public on its own may appear there; the
        // debate renderings (HTML, Flight, API) must never carry either side.
        const where = side === brokenSide ? body : [s.html, s.flight, s.active].join('\n')
        expect(where, `${why}: ${x}`).not.toContain(x)
      }
      expect(body, `${why}: debate title`).not.toContain(`WF DebVis ${run} debate`)
      expect(body, `${why}: debate description`).not.toContain(`WF DebVis ${run} description`)
      expect(s.active.trim()).toBe('null')
      // Nothing about a debate answer may be cached by a shared cache.
      const cc = (await request.get('/opinion-debate')).headers()['cache-control'] ?? ''
      expect(cc, `${why}: cache-control`).not.toMatch(/s-maxage=[1-9]|public, max-age=[1-9]/)
    }

    // 1. An editor archives the AGAINST argument.
    expect((await admin.request.put(`/api/articles/${a.id}`, { headers: h, data: { status: 'ARCHIVED', publicationIntent: true } })).ok()).toBe(true)
    await expectAbsent('archived', 'against')
    expect((await request.get(`/articles/${a.slug}`)).status()).toBe(404)
    // A refused vote leaves no vote behind.
    expect((await request.post(`/api/debates/${debate.id}/vote`, { headers: h, data: { side: 'FOR' } })).status()).toBe(404)
    expect(await db().debateVote.count({ where: { debateId: debate.id } })).toBe(0)
    // Reading changed nothing: the article is still archived, not silently republished.
    expect((await db().article.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ARCHIVED')

    // 2. The editor publishes it again through the normal action: the debate returns at once.
    expect((await admin.request.put(`/api/articles/${a.id}`, { headers: h, data: { status: 'PUBLISHED', publicationIntent: true } })).ok()).toBe(true)
    expect(await served(request)).toMatchObject({ active: expect.stringContaining(`WF DebVis ${run} debate`) })
    expect((await served(request)).html).toContain(SECRETS('against')[0])

    // 3. The editor trashes the FOR argument: gone again; restoring it from Trash brings it back.
    expect((await admin.request.delete(`/api/articles/${f.id}`, { headers: h })).ok()).toBe(true)
    await expectAbsent('trashed', 'for')
    expect((await db().article.findUniqueOrThrow({ where: { id: f.id } })).deletedAt).not.toBeNull()
    expect((await admin.request.patch(`/api/editorial/trash/${f.id}`, { headers: h })).ok()).toBe(true)
    const back = await served(request)
    expect(back.html).toContain(SECRETS('for')[0])
    expect(back.flight).toContain(SECRETS('for')[0])
    expect(back.active).toContain(`WF DebVis ${run} debate`)
  } finally { await admin.close() }
})
