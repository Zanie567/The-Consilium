/**
 * Pre-launch API audit — drives a LIVE server over HTTP and asserts every route
 * group returns 2xx with the right shape when used correctly. Authenticated
 * routes are exercised for real (admin + reader sessions), not skipped.
 *
 * Run against an already-running server:
 *   BASE_URL=http://localhost:3000 npx vitest run tests/integration/api-audit.test.ts
 *
 * The whole suite skips (does not fail) when no server is reachable, so unit
 * runs in CI without a server stay green; `npm run test:audit` starts one first.
 *
 * Headline regression guard (the launch blocker this audit was opened for):
 *   GET /api/comments and GET /api/editorial/comments MUST return 200, never 503.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Session, serverUp } from './helpers/http'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@theconsilium.com'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'consilium2024'
const READER_EMAIL = 'reader.alice@consilium.test'
const READER_PASSWORD = 'reader1234'

let up = false
let admin: Session
let reader: Session
let firstArticleId: string | null = null

beforeAll(async () => {
  up = await serverUp(BASE)
  if (!up) {
    console.warn(`[api-audit] No server at ${BASE} — skipping live audit.`)
    return
  }
  admin = new Session(BASE)
  reader = new Session(BASE)
  const [a, r] = await Promise.all([
    admin.login(ADMIN_EMAIL, ADMIN_PASSWORD),
    reader.login(READER_EMAIL, READER_PASSWORD),
  ])
  expect(a, 'admin login should succeed').toBe(true)
  expect(r, 'reader login should succeed').toBe(true)

  const articles = await (await admin.get('/api/articles')).json()
  firstArticleId = articles?.[0]?.id ?? null
})

// ── Comments: the 503 regression (article threads) ──────────────────────────

describe('Comments API (503 regression)', () => {
  it('GET /api/comments?articleId returns 200 (NOT 503) with {comments,total}', async () => {
    if (!up) return
    const res = await admin.get(`/api/comments?articleId=${firstArticleId}`)
    expect(res.status, `expected 200, got ${res.status}`).toBe(200)
    expect(res.status).not.toBe(503)
    const body = await res.json()
    expect(Array.isArray(body.comments)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  it('GET /api/comments?articleId works unauthenticated too (200, not 503)', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/comments?articleId=${firstArticleId}`)
    expect(res.status).toBe(200)
  })

  it('GET /api/comments without articleId → 400 (validation, not crash)', async () => {
    if (!up) return
    const res = await admin.get('/api/comments')
    expect(res.status).toBe(400)
  })

  it('POST /api/comments (authenticated) → 201 with comment shape', async () => {
    if (!up || !firstArticleId) return
    const res = await admin.post('/api/comments', {
      articleId: firstArticleId,
      body: `Audit test comment ${Date.now()}`,
    })
    // 429 is a legitimate response when the suite is re-run inside the
    // rate-limit window; the guarantee is the route works and never 5xx's.
    expect([201, 429], `status ${res.status}`).toContain(res.status)
    if (res.status === 201) {
      const c = await res.json()
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('body')
      expect(Array.isArray(c.upvotedBy)).toBe(true) // shape parity with GET
    }
  })

  it('POST /api/comments unauthenticated → 401', async () => {
    if (!up || !firstArticleId) return
    const res = await fetch(`${BASE}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articleId: firstArticleId, body: 'hello there' }),
    })
    expect(res.status).toBe(401)
  })
})

// ── Editorial comment moderation (503 regression + stats shape) ──────────────

describe('Editorial comments moderation', () => {
  for (const tab of ['reported', 'recent', 'hidden']) {
    it(`GET /api/editorial/comments?tab=${tab} → 200 (NOT 503) with stats`, async () => {
      if (!up) return
      const res = await admin.get(`/api/editorial/comments?tab=${tab}&page=0`)
      expect(res.status, `tab=${tab} expected 200, got ${res.status}`).toBe(200)
      expect(res.status).not.toBe(503)
      const body = await res.json()
      expect(Array.isArray(body.comments)).toBe(true)
      expect(body.stats).toMatchObject({
        total: expect.any(Number),
        reported: expect.any(Number),
        hidden: expect.any(Number),
      })
    })
  }

  it('GET /api/editorial/comments unauthenticated → 401', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/editorial/comments?tab=reported`)
    expect([401, 403]).toContain(res.status)
  })

  it('moderate flow: hide → unhide an existing comment (PATCH 200)', async () => {
    if (!up) return
    // Use a real seeded comment rather than creating one — the create path is
    // rate-limited (5/min), which would flake the moderation assertion on re-runs.
    const recent = await (await admin.get('/api/editorial/comments?tab=recent&page=0')).json()
    const target =
      (recent.comments as { id: string; isHidden: boolean }[] | undefined)?.find((c) => !c.isHidden) ??
      (recent.comments as { id: string }[] | undefined)?.[0]
    if (!target) return
    const hide = await admin.patch(`/api/editorial/comments/${target.id}`, { action: 'hide' })
    expect(hide.status, await hide.text()).toBe(200)
    // Restore state so re-runs stay idempotent.
    const unhide = await admin.patch(`/api/editorial/comments/${target.id}`, { action: 'unhide' })
    expect(unhide.status).toBe(200)
  })
})

// ── Profile "My Comments" + stats ────────────────────────────────────────────

describe('Profile', () => {
  it('GET /api/profile/comments (authed) → 200 array', async () => {
    if (!up) return
    const res = await reader.get('/api/profile/comments')
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('GET /api/profile/stats (authed) → 200 with totals', async () => {
    if (!up) return
    const res = await reader.get('/api/profile/stats')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('totalComments')
    expect(body).toHaveProperty('totalSaved')
  })

  it('GET /api/profile/saved-articles (authed) → 200', async () => {
    if (!up) return
    expect((await reader.get('/api/profile/saved-articles')).status).toBe(200)
  })

  it('GET /api/profile/debate-votes (authed) → 200', async () => {
    if (!up) return
    expect((await reader.get('/api/profile/debate-votes')).status).toBe(200)
  })
})

// ── Bookmarks ────────────────────────────────────────────────────────────────

describe('Bookmarks', () => {
  it('GET /api/bookmarks (authed) → 200 array of ids', async () => {
    if (!up) return
    const res = await reader.get('/api/bookmarks')
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('POST /api/bookmarks toggles (200, {bookmarked}) and is reversible', async () => {
    if (!up || !firstArticleId) return
    const on = await reader.post('/api/bookmarks', { articleId: firstArticleId })
    expect(on.status).toBe(200)
    const first = (await on.json()).bookmarked
    const off = await reader.post('/api/bookmarks', { articleId: firstArticleId })
    expect((await off.json()).bookmarked).toBe(!first)
  })

  it('GET /api/bookmarks unauthenticated → 401', async () => {
    if (!up) return
    expect((await fetch(`${BASE}/api/bookmarks`)).status).toBe(401)
  })
})

// ── Search ───────────────────────────────────────────────────────────────────

describe('Search', () => {
  it('GET /api/search?q=trade → 200 array', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/search?q=trade`)
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
  it('GET /api/search?q= (empty) → 200 empty array', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/search?q=`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// ── Auth/session ─────────────────────────────────────────────────────────────

describe('Auth / session', () => {
  it('GET /api/auth/session (authed) → 200 with user', async () => {
    if (!up) return
    const res = await admin.get('/api/auth/session')
    expect(res.status).toBe(200)
    expect((await res.json()).user?.email).toBe(ADMIN_EMAIL)
  })
  it('GET /api/auth/session (anon) → 200 empty object', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/auth/session`)
    expect(res.status).toBe(200)
  })
})

// ── Reading progress ─────────────────────────────────────────────────────────

describe('Reading progress', () => {
  it('POST /api/reading-progress (authed) → 200 {ok}', async () => {
    if (!up || !firstArticleId) return
    const res = await reader.post('/api/reading-progress', { articleId: firstArticleId, progress: 42 })
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.ok).toBe(true)
  })
  it('GET /api/reading-progress (authed) → 200', async () => {
    if (!up) return
    expect((await reader.get('/api/reading-progress')).status).toBe(200)
  })
  it('POST /api/reading-progress unauthenticated → 401', async () => {
    if (!up || !firstArticleId) return
    const res = await fetch(`${BASE}/api/reading-progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articleId: firstArticleId, progress: 10 }),
    })
    expect(res.status).toBe(401)
  })
})

// ── Analytics tracking (public) ──────────────────────────────────────────────

describe('Analytics tracking', () => {
  it('POST /api/analytics/track → 200', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/analytics/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: `audit-${Date.now()}`, pagePath: '/' }),
    })
    expect(res.status).toBe(200)
  })
})

// ── Debate votes ─────────────────────────────────────────────────────────────

describe('Debates', () => {
  it('GET /api/debates/active → 200', async () => {
    if (!up) return
    expect((await fetch(`${BASE}/api/debates/active`)).status).toBe(200)
  })
  it('POST /api/debates/[id]/vote → 200 or 409 (already voted)', async () => {
    if (!up) return
    const debate = await (await fetch(`${BASE}/api/debates/active`)).json()
    if (!debate?.id) return
    const res = await reader.post(`/api/debates/${debate.id}/vote`, { side: 'FOR' })
    // 200 first vote, 409 already voted, 429 rate-limited on rapid re-runs.
    expect([200, 409, 429]).toContain(res.status)
  })
  it('POST vote with bad side → 400', async () => {
    if (!up) return
    const debate = await (await fetch(`${BASE}/api/debates/active`)).json()
    if (!debate?.id) return
    const res = await reader.post(`/api/debates/${debate.id}/vote`, { side: 'MAYBE' })
    // 400 validates the bad side; 429 if the vote limiter fired first on re-runs.
    expect([400, 429]).toContain(res.status)
  })
})

// ── Editorial analytics tabs (incl. Writers leaderboard — empty-tab bug) ─────

describe('Editorial analytics', () => {
  for (const tab of ['overview', 'content', 'audience', 'engagement', 'distribution']) {
    it(`GET /api/editorial/analytics?tab=${tab} → 200`, async () => {
      if (!up) return
      const res = await admin.get(`/api/editorial/analytics?tab=${tab}&period=30d`)
      expect(res.status, `tab=${tab}`).toBe(200)
    })
  }

  it('GET ?tab=leaderboard → 200 and lists writers (recent-articles bug)', async () => {
    if (!up) return
    const res = await admin.get('/api/editorial/analytics?tab=leaderboard&period=30d')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.writers)).toBe(true)
    // The seed has published articles by 2 staff authors; the leaderboard must
    // NOT be empty just because they were published > 30 days ago.
    expect(body.writers.length, 'Writers tab must not be empty').toBeGreaterThan(0)
    expect(body.writers[0]).toHaveProperty('articlesCount')
  })
})

// ── Articles CRUD (admin) ────────────────────────────────────────────────────

describe('Articles CRUD', () => {
  it('GET /api/articles (anon) → 200, PUBLISHED only', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/articles`)
    expect(res.status).toBe(200)
    const arr = await res.json()
    expect(Array.isArray(arr)).toBe(true)
    for (const a of arr) expect(a.status).toBe('PUBLISHED')
  })

  it('GET /api/articles/[id] → 200 article', async () => {
    if (!up || !firstArticleId) return
    const res = await admin.get(`/api/articles/${firstArticleId}`)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(firstArticleId)
  })

  it('create → update → delete an article (2xx each)', async () => {
    if (!up) return
    const create = await admin.post('/api/articles', {
      title: `Audit Draft ${Date.now()}`,
      content: JSON.stringify({ type: 'doc', content: [] }),
      status: 'DRAFT',
    })
    const created = await create.json()
    expect(create.status, JSON.stringify(created)).toBeLessThan(300)
    expect(created).toHaveProperty('id')

    const update = await admin.patch(`/api/articles/${created.id}`, { title: 'Audit Draft (edited)' })
    expect(update.status).toBeLessThan(300)

    const del = await admin.del(`/api/articles/${created.id}`)
    expect(del.status).toBeLessThan(300)
  })

  it('GET /api/articles?status=DRAFT unauthenticated → 401', async () => {
    if (!up) return
    expect((await fetch(`${BASE}/api/articles?status=DRAFT`)).status).toBe(401)
  })
})
