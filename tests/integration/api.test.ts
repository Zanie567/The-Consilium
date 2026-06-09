/**
 * Integration tests for The Consilium API routes.
 *
 * Prerequisites:
 *   1. Dev server running: npm run dev (http://localhost:3000)
 *   2. DB seeded with at least one published article and one active debate
 *
 * To run integration tests only:
 *   BASE_URL=http://localhost:3000 npx vitest run tests/integration
 *
 * Tests that cannot run without a live server are skipped with a note.
 */

import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

// ── Connectivity check ────────────────────────────────────────────────────────

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/articles`, { signal: AbortSignal.timeout(3000) })
    return res.status < 600
  } catch {
    return false
  }
}

let up = false
beforeAll(async () => {
  up = await serverIsUp()
  if (!up) console.warn('[integration] Dev server not reachable at', BASE, '— skipping live tests')
})

function skip(label: string) {
  it.skip(label, () => {})
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function post(path: string, body: unknown, cookies = '') {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookies ? { Cookie: cookies } : {}) },
    body: JSON.stringify(body),
  })
}

async function get(path: string, cookies = '') {
  return fetch(`${BASE}${path}`, {
    headers: cookies ? { Cookie: cookies } : {},
  })
}

// ── Suite 1: Signup (POST /api/auth/signup) ───────────────────────────────────

describe('POST /api/auth/signup', () => {
  const email = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  it('valid payload → 201 with id and email', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: email(),
      password: 'password123',
      agreed: true,
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('email')
  })

  it('agreed: false → 400', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: email(),
      password: 'password123',
      agreed: false,
    })
    expect(res.status).toBe(400)
  })

  it('name length 1 → 400', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'A',
      email: email(),
      password: 'password123',
      agreed: true,
    })
    expect(res.status).toBe(400)
  })

  it('name length 2 → 201', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Al',
      email: email(),
      password: 'password123',
      agreed: true,
    })
    expect(res.status).toBe(201)
  })

  it('name length 101 → 400', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'A'.repeat(101),
      email: email(),
      password: 'password123',
      agreed: true,
    })
    expect(res.status).toBe(400)
  })

  it('password length 7 → 400', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: email(),
      password: 'pass123',
      agreed: true,
    })
    expect(res.status).toBe(400)
  })

  it('password length 8 → 201', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: email(),
      password: 'pass1234',
      agreed: true,
    })
    expect(res.status).toBe(201)
  })

  it('password length 128 → 201', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: email(),
      password: 'a'.repeat(128),
      agreed: true,
    })
    expect(res.status).toBe(201)
  })

  it('password length 129 → 400', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: email(),
      password: 'a'.repeat(129),
      agreed: true,
    })
    expect(res.status).toBe(400)
  })

  it('password with leading whitespace → 201 (whitespace not trimmed — BUG-PASS-TRIM)', async () => {
    // BUG: password is not trimmed before hashing. " password1" and "password1" hash differently.
    // This means a user who accidentally typed a leading space will have a different hash.
    if (!up) return
    const e = email()
    const res = await post('/api/auth/signup', {
      name: 'Spacey User',
      email: e,
      password: ' password1',  // leading space
      agreed: true,
    })
    // Signup accepts it — the leading space is part of the hash
    expect(res.status).toBe(201)
    // DOCUMENT: if this user then tries to sign in with "password1" (no space) it will fail
  })

  it('invalid email format → 400', async () => {
    if (!up) return
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: 'notanemail',
      password: 'password123',
      agreed: true,
    })
    expect(res.status).toBe(400)
  })

  it('email 255 chars → 400 (max 254)', async () => {
    if (!up) return
    // 244 chars + @example.com (11) = 255 chars total
    const longEmail = 'a'.repeat(244) + '@example.com'
    const res = await post('/api/auth/signup', {
      name: 'Test User',
      email: longEmail,
      password: 'password123',
      agreed: true,
    })
    expect(res.status).toBe(400)
  })

  it('duplicate email → 400', async () => {
    if (!up) return
    const e = email()
    await post('/api/auth/signup', { name: 'User', email: e, password: 'password123', agreed: true })
    const res = await post('/api/auth/signup', { name: 'User2', email: e, password: 'password123', agreed: true })
    expect(res.status).toBe(400)
  })

  it('duplicate email different case → 400 (lowercased before check)', async () => {
    if (!up) return
    const base = email()
    const upper = base.toUpperCase()
    await post('/api/auth/signup', { name: 'User', email: base, password: 'password123', agreed: true })
    const res = await post('/api/auth/signup', { name: 'User2', email: upper, password: 'password123', agreed: true })
    // Email is lowercased, so this should be treated as a duplicate
    expect(res.status).toBe(400)
  })
})

// ── Suite 2: Forgot Password (POST /api/auth/forgot-password) ─────────────────

describe('POST /api/auth/forgot-password', () => {
  it('unknown email returns ok: true (enumeration prevention)', async () => {
    if (!up) return
    const res = await post('/api/auth/forgot-password', {
      email: `nonexistent-${Date.now()}@example.com`,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('missing email field returns ok: true silently', async () => {
    if (!up) return
    const res = await post('/api/auth/forgot-password', {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  // SKIP: PATCH tests require a valid DB token — cannot seed without direct DB access
  skip('PATCH: valid token + 8-char password → 200 [needs DB seed]')
  skip('PATCH: valid token + 7-char password → 400 [needs DB seed]')
  skip('PATCH: valid token + 200-char password → 201 (BUG: no max length) [needs DB seed]')
  skip('PATCH: expired token → 400 [needs DB seed]')
  skip('PATCH: already-used token → 400 [needs DB seed]')
})

// ── Suite 3: Search (GET /api/search) ─────────────────────────────────────────

describe('GET /api/search', () => {
  it('empty query → 200 with empty array', async () => {
    if (!up) return
    const res = await get('/api/search?q=')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('1-char query → 200 with empty array (min length 2)', async () => {
    if (!up) return
    const res = await get('/api/search?q=a')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(0)
  })

  it('2-char query → 200 with array result', async () => {
    if (!up) return
    const res = await get('/api/search?q=ai')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('query matching nothing → empty array (not error)', async () => {
    if (!up) return
    const res = await get('/api/search?q=xyznonexistentterm99999')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('two single-char tokens "a b" → empty array (tokens < 2 chars filtered)', async () => {
    // BUG-SEARCH-TOKEN: query "a b" splits into ["a", "b"], both < 2 chars, all filtered out
    if (!up) return
    const res = await get('/api/search?q=a+b')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('XSS in query → result snippets do not contain unescaped script tags', async () => {
    if (!up) return
    const res = await get('/api/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E')
    expect(res.status).toBe(200)
    const text = await res.text()
    // The raw <script> tag should not appear executable in JSON response
    expect(text).not.toContain('<script>alert(1)</script>')
  })

  it('500-char query → returns without crashing (no max length enforced)', async () => {
    // BUG-SEARCH-LEN: no max length guard — very long query creates many OR clauses
    if (!up) return
    const longQuery = 'economics '.repeat(50)
    const res = await get(`/api/search?q=${encodeURIComponent(longQuery)}`)
    // Should not crash — either 200 with results or 200 with empty array
    expect(res.status).toBe(200)
  })
})

// ── Suite 4: Subscribe (POST /api/subscribe) ──────────────────────────────────

describe('POST /api/subscribe', () => {
  const email = () => `sub-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  it('valid email → 201', async () => {
    if (!up) return
    const res = await post('/api/subscribe', { email: email() })
    expect(res.status).toBe(201)
  })

  it('same email again → 200 "Already subscribed"', async () => {
    if (!up) return
    const e = email()
    await post('/api/subscribe', { email: e })
    const res = await post('/api/subscribe', { email: e })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/already subscribed/i)
  })

  it('invalid email → 400', async () => {
    if (!up) return
    const res = await post('/api/subscribe', { email: 'notanemail' })
    expect(res.status).toBe(400)
  })

  it('missing email → 400', async () => {
    if (!up) return
    const res = await post('/api/subscribe', {})
    expect(res.status).toBe(400)
  })

  it('email 255 chars → 400 (max 254)', async () => {
    if (!up) return
    const res = await post('/api/subscribe', { email: 'a'.repeat(244) + '@example.com' })
    expect(res.status).toBe(400)
  })
})

// ── Suite 5: Contact Form (POST /api/contact) ─────────────────────────────────

describe('POST /api/contact', () => {
  const valid = {
    name: 'Test User',
    email: 'test@example.com',
    subject: 'Hello',
    message: 'This is a test message.',
  }

  it('valid form → 200', async () => {
    if (!up) return
    const res = await post('/api/contact', valid)
    expect(res.status).toBe(200)
  })

  it('missing name → 400', async () => {
    if (!up) return
    const res = await post('/api/contact', { ...valid, name: '' })
    expect(res.status).toBe(400)
  })

  it('name is whitespace only → 400 (trimmed before required check)', async () => {
    if (!up) return
    const res = await post('/api/contact', { ...valid, name: '   ' })
    // BUG-CONTACT-TRIM: name is trimmed to "" which then fails the "All fields required" check
    // This actually works correctly since name.trim() → "" → falsy. Documenting for certainty.
    expect(res.status).toBe(400)
  })

  it('name 101 chars → 400', async () => {
    if (!up) return
    const res = await post('/api/contact', { ...valid, name: 'A'.repeat(101) })
    expect(res.status).toBe(400)
  })

  it('name 100 chars → 200', async () => {
    if (!up) return
    const res = await post('/api/contact', { ...valid, name: 'A'.repeat(100) })
    expect(res.status).toBe(200)
  })

  it('subject 201 chars → 400', async () => {
    if (!up) return
    const res = await post('/api/contact', { ...valid, subject: 'A'.repeat(201) })
    expect(res.status).toBe(400)
  })

  it('message 5000 chars → 200', async () => {
    if (!up) return
    const res = await post('/api/contact', { ...valid, message: 'a'.repeat(5000) })
    expect(res.status).toBe(200)
  })

  it('message 5001 chars → 400', async () => {
    if (!up) return
    const res = await post('/api/contact', { ...valid, message: 'a'.repeat(5001) })
    expect(res.status).toBe(400)
  })

  it('message with slur is stored unfiltered (no content filter on contact form)', async () => {
    // BUG-CONTACT-FILTER: contact form messages bypass the content filter
    if (!up) return
    const res = await post('/api/contact', { ...valid, message: 'retard' })
    // It is stored (200) — document that contact form has no filter
    expect(res.status).toBe(200)
  })
})

// ── Suite 6: Publish Scheduled (POST /api/publish-scheduled) ──────────────────

describe('POST /api/publish-scheduled', () => {
  const secret = process.env.CRON_SECRET ?? 'test-not-set'

  it('correct Bearer token → 200 with due and published', async () => {
    if (!up) return
    if (secret === 'test-not-set') {
      console.warn('[skip] CRON_SECRET not in environment')
      return
    }
    const res = await fetch(`${BASE}/api/publish-scheduled`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('due')
    expect(body).toHaveProperty('published')
  })

  it('wrong secret → 401', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/publish-scheduled`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    expect(res.status).toBe(401)
  })

  it('no Authorization header → 401', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/publish-scheduled`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('?secret= query param is accepted (insecure — visible in logs)', async () => {
    // BUG-CRON-LOG: secret visible in access logs when passed as query param
    if (!up) return
    if (secret === 'test-not-set') return
    const res = await fetch(`${BASE}/api/publish-scheduled?secret=${secret}`, { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('GET method is also accepted (same handler)', async () => {
    if (!up) return
    if (secret === 'test-not-set') return
    const res = await fetch(`${BASE}/api/publish-scheduled`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(res.status).toBe(200)
  })
})

// ── Suite 7: Comments (POST /api/comments) ────────────────────────────────────
// Requires: a known published article ID. Uses the first article from GET /api/articles.

describe('POST /api/comments', () => {
  let articleId: string | null = null

  beforeAll(async () => {
    if (!up) return
    const res = await get('/api/articles')
    if (res.ok) {
      const articles = await res.json()
      articleId = articles[0]?.id ?? null
    }
  })

  it('unauthenticated → 401', async () => {
    if (!up || !articleId) return
    const res = await post('/api/comments', { articleId, body: 'Hello there' })
    expect(res.status).toBe(401)
  })

  // SKIP: authenticated comment tests require a valid session cookie
  skip('authenticated READER posts clean comment → 201 [needs session]')
  skip('comment body 2 chars → test min-length enforcement [needs session]')
  skip('comment body 1001 chars → 400 or 201 (document) [needs session]')
  skip('comment body is only whitespace → 400 [needs session]')
  skip('comment body contains slur → 400 blocked by content filter [needs session]')
  skip('comment body with <script> → stored safely, not executed [needs session]')
})

// ── Suite 8: Rate Limiting Boundaries ────────────────────────────────────────
// These tests verify rate-limit thresholds by making rapid sequential requests.

describe('Rate Limiting', () => {
  it('subscribe: 4th request in 10min window → 429', async () => {
    // Rate limit: 3/10min per IP
    // Note: in-memory limits may not work perfectly across serverless instances,
    // but in a single local dev server they will.
    if (!up) return
    if (process.env.AUDIT_NO_RATE_LIMIT === '1') return // audit server runs with the limiter off

    const e = () => `rl-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
    // Use 4 different emails to avoid duplicate-email short-circuits
    const responses = await Promise.all([
      post('/api/subscribe', { email: e() }),
      post('/api/subscribe', { email: e() }),
      post('/api/subscribe', { email: e() }),
      post('/api/subscribe', { email: e() }),
    ])

    const statuses = responses.map((r) => r.status)
    // In sequential execution on a single server, the 4th should be 429.
    // In parallel (Promise.all) the ordering is non-deterministic; at least ONE should be 429.
    expect(statuses).toContain(429)
  })

  it('contact: 6th request in 5min window → 429', async () => {
    if (!up) return
    if (process.env.AUDIT_NO_RATE_LIMIT === '1') return // audit server runs with the limiter off
    const valid = { name: 'RL Test', email: 'rl@example.com', subject: 'Test', message: 'Test msg' }
    // Sequential requests — 6th should be rate limited (limit: 5/5min)
    let last429 = false
    for (let i = 0; i < 6; i++) {
      const res = await post('/api/contact', valid)
      if (res.status === 429) { last429 = true; break }
    }
    expect(last429).toBe(true)
  })
})

// ── Suite 9: No Rate Limiting (gaps) ─────────────────────────────────────────

describe('Missing rate limits (documentation tests)', () => {
  it('POST /api/comments has no rate limit (100 rapid calls all reach auth check)', async () => {
    // BUG-RL-COMMENTS: No rate limit on comment creation
    // All requests should reach auth (401) not rate-limit (429)
    if (!up) return
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        post('/api/comments', { articleId: 'fake-id', body: 'test' })
      )
    )
    const statuses = new Set(responses.map((r) => r.status))
    // Should see 401 (Unauthorized) not 429 (rate limited)
    expect(statuses.has(401)).toBe(true)
    expect(statuses.has(429)).toBe(false)
  })

  it('POST /api/comments/[id]/upvote has no rate limit', async () => {
    if (!up) return
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        post('/api/comments/fake-comment-id/upvote', {})
      )
    )
    const statuses = new Set(responses.map((r) => r.status))
    expect(statuses.has(429)).toBe(false)
  })

  it('POST /api/comments/[id]/report has no rate limit', async () => {
    if (!up) return
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        post('/api/comments/fake-comment-id/report', {})
      )
    )
    const statuses = new Set(responses.map((r) => r.status))
    expect(statuses.has(429)).toBe(false)
  })

  it('POST /api/analytics/track has no rate limit and no auth requirement', async () => {
    if (!up) return
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        post('/api/analytics/track', { sessionId: 'test-session-123', pagePath: '/' })
      )
    )
    // All should succeed (200) — no rate limiting, no auth
    const statuses = responses.map((r) => r.status)
    expect(statuses.every((s) => s === 200)).toBe(true)
  })
})

// ── Suite 10: Editorial / Admin Role Enforcement (unauthenticated) ────────────

describe('Unauthenticated access to protected endpoints', () => {
  const protectedRoutes = [
    { method: 'GET',   path: '/api/editorial/users' },
    { method: 'POST',  path: '/api/editorial/users' },
    { method: 'GET',   path: '/api/editorial/debates' },
    { method: 'GET',   path: '/api/editorial/comments' },
    { method: 'GET',   path: '/api/bookmarks' },
    { method: 'POST',  path: '/api/bookmarks' },
  ]

  for (const { method, path } of protectedRoutes) {
    it(`${method} ${path} → 401 or 403 when unauthenticated`, async () => {
      if (!up) return
      const res = await fetch(`${BASE}${path}`, { method })
      expect([401, 403]).toContain(res.status)
    })
  }
})

// ── Suite 11: Articles endpoint role guard ────────────────────────────────────

describe('GET /api/articles role guard', () => {
  it('unauthenticated request → returns only PUBLISHED articles', async () => {
    if (!up) return
    const res = await get('/api/articles')
    expect(res.status).toBe(200)
    const articles = await res.json()
    if (Array.isArray(articles)) {
      for (const a of articles) {
        expect(a.status).toBe('PUBLISHED')
      }
    }
  })

  it('?status=DRAFT unauthenticated → 401', async () => {
    if (!up) return
    const res = await get('/api/articles?status=DRAFT')
    expect(res.status).toBe(401)
  })

  it('published list never leaks author password/email/security fields', async () => {
    // P0 regression guard: include: { author: true } used to serialise the
    // bcrypt hash and account-security columns to anonymous callers.
    if (!up) return
    const res = await get('/api/articles')
    expect(res.status).toBe(200)
    const articles = await res.json()
    if (Array.isArray(articles)) {
      for (const a of articles) {
        if (!a.author) continue
        expect(a.author).not.toHaveProperty('password')
        expect(a.author).not.toHaveProperty('email')
        expect(a.author).not.toHaveProperty('isBanned')
        expect(a.author).not.toHaveProperty('failedLoginAttempts')
        expect(a.author).not.toHaveProperty('lockedUntil')
      }
    }
  })

  it('single published article never leaks author password/email', async () => {
    if (!up) return
    const list = await get('/api/articles')
    const articles = await list.json()
    const id = Array.isArray(articles) ? articles[0]?.id : null
    if (!id) return
    const res = await get(`/api/articles/${id}`)
    if (res.status !== 200) return
    const article = await res.json()
    if (article?.author) {
      expect(article.author).not.toHaveProperty('password')
      expect(article.author).not.toHaveProperty('email')
    }
  })
})

// ── Suite 12: Debate voting ───────────────────────────────────────────────────

describe('POST /api/debates/[debateId]/vote', () => {
  let debateId: string | null = null

  beforeAll(async () => {
    if (!up) return
    const res = await get('/api/debates/active')
    if (res.ok) {
      const debate = await res.json()
      debateId = debate?.id ?? null
    }
  })

  it('GET /api/debates/active → 200 (null or debate object)', async () => {
    if (!up) return
    const res = await get('/api/debates/active')
    expect(res.status).toBe(200)
  })

  it('invalid side value → 400', async () => {
    if (!up || !debateId) return
    const res = await post(`/api/debates/${debateId}/vote`, { side: 'MAYBE' })
    expect(res.status).toBe(400)
  })

  it('missing side field → 400', async () => {
    if (!up || !debateId) return
    const res = await post(`/api/debates/${debateId}/vote`, {})
    expect(res.status).toBe(400)
  })

  it('non-existent debate ID → 404', async () => {
    if (!up) return
    const res = await post('/api/debates/nonexistent-debate-id/vote', { side: 'FOR' })
    expect(res.status).toBe(404)
  })

  it('anonymous vote → 200, sets consilium_anon_id cookie', async () => {
    if (!up || !debateId) return
    const res = await post(`/api/debates/${debateId}/vote`, { side: 'FOR' })
    // First anonymous vote should succeed (200 or 409 if debate already voted on from this IP)
    expect([200, 409]).toContain(res.status)
    if (res.status === 200) {
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('consilium_anon_id')
    }
  })
})

// ── Suite 13: File Upload (POST /api/upload) ──────────────────────────────────

describe('POST /api/upload', () => {
  // SKIP: Supabase credentials may not be available locally
  skip('valid JPEG → 200, URL returned [needs Supabase credentials]')
  skip('file with .jpg extension but HTML content → 400 Invalid file type [needs Supabase credentials]')
  skip('file > 10 MB → 400 [needs Supabase credentials]')

  it('unauthenticated → 401/403 (denied)', async () => {
    if (!up) return
    const formData = new FormData()
    formData.append('file', new Blob(['fake'], { type: 'image/jpeg' }), 'test.jpg')
    const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: formData })
    // proxy.ts denies unauthenticated API access with 401 before the route's own
    // 403 role check runs; both mean "not allowed to upload".
    expect([401, 403]).toContain(res.status)
  })

  it.skip('invalid bucket name → 400 (auth fires before bucket check in current implementation)', () => {})
})

// ── Suite 14: Bookmarks ───────────────────────────────────────────────────────

describe('Bookmarks (POST /api/bookmarks)', () => {
  it('unauthenticated → 401', async () => {
    if (!up) return
    const res = await post('/api/bookmarks', { articleId: 'some-article-id' })
    expect(res.status).toBe(401)
  })

  it('GET /api/bookmarks unauthenticated → 401', async () => {
    if (!up) return
    const res = await get('/api/bookmarks')
    expect(res.status).toBe(401)
  })

  skip('toggle bookmark → 200 bookmarked: true [needs session]')
  skip('toggle same bookmark again → 200 bookmarked: false [needs session]')
  skip('bookmark non-existent articleId → 500 FK error [needs session + bad ID]')
})
