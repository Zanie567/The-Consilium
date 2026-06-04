/**
 * In-process route-handler tests.
 *
 * Unlike `api.test.ts` (which drives a live dev server over HTTP and skips when
 * none is running), these import the App Router handlers directly and run them
 * with mocked `prisma` / auth / email collaborators. They need no server and no
 * database, so they execute on every `npm test` run and in CI — covering the
 * authorization and validation logic of the routes most recently changed.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

// vi.mock is hoisted above imports; vi.hoisted lets the factories reference these.
// adminNote/auditLog/email use resolved-promise defaults because the routes call
// them fire-and-forget with `.catch(...)`.
const { prismaMock, authMock } = vi.hoisted(() => {
  const resolved = () => Promise.resolve({})
  return {
    prismaMock: {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      writerStreak: { findUnique: vi.fn(), upsert: vi.fn() },
      adminNote: { create: vi.fn(resolved) },
      auditLog: { create: vi.fn(resolved) },
      article: { findMany: vi.fn() },
    },
    authMock: { getVerifiedSessionUser: vi.fn() },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(() => Promise.resolve()),
  roleChangedEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
}))
vi.mock('@/lib/gamification/streaks', () => ({ recalculateStreakForUser: vi.fn(() => Promise.resolve()) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))

import { POST as setupPOST } from '@/app/api/editorial/setup/route'
import { PATCH as rolePATCH } from '@/app/api/admin/users/[userId]/role/route'
import { GET as analyticsGET } from '@/app/api/editorial/analytics/route'
import { POST as uploadPOST } from '@/app/api/upload/route'
import { GET as streakGET, PATCH as streakPATCH } from '@/app/api/user/streak/route'
import { POST as cronPOST } from '@/app/api/cron/recalculate-streaks/route'

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Ada', email: 'ada@consilium.test' }
const WRITER = { id: 'writer-1', role: 'WRITER', name: 'Wes', email: 'wes@consilium.test' }

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function nextJsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => vi.clearAllMocks())

// ── editorial/setup: first-run bootstrap guard ───────────────────────────────

describe('POST /api/editorial/setup', () => {
  it('returns 403 once an admin exists and never creates a user', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'admin-1' })
    const res = await setupPOST(
      jsonRequest('http://localhost/api/editorial/setup', 'POST', {
        name: 'Mallory',
        email: 'mallory@example.com',
        password: 'password1',
      })
    )
    expect(res.status).toBe(403)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than 8 characters with 400', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    const res = await setupPOST(
      jsonRequest('http://localhost/api/editorial/setup', 'POST', {
        name: 'Admin',
        email: 'admin@example.com',
        password: 'short',
      })
    )
    expect(res.status).toBe(400)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('creates the first admin (email lowercased, role ADMIN) → 200', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.create.mockResolvedValue({ id: 'admin-1' })
    const res = await setupPOST(
      jsonRequest('http://localhost/api/editorial/setup', 'POST', {
        name: 'First Admin',
        email: 'First.Admin@Example.com',
        password: 'password1',
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const data = prismaMock.user.create.mock.calls[0][0].data
    expect(data.email).toBe('first.admin@example.com')
    expect(data.role).toBe('ADMIN')
  })
})

// ── admin role change: privilege-escalation guards ───────────────────────────

describe('PATCH /api/admin/users/[userId]/role', () => {
  const call = (userId: string, body: unknown) =>
    rolePATCH(nextJsonRequest(`http://localhost/api/admin/users/${userId}/role`, 'PATCH', body), {
      params: Promise.resolve({ userId }),
    })

  it('returns 403 when the caller is not an admin', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await call('writer-1', { role: 'EDITOR' })
    expect(res.status).toBe(403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('prevents an admin from changing their own role → 400', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    const res = await call('admin-1', { role: 'READER' })
    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid role value → 400', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    const res = await call('writer-1', { role: 'SUPERUSER' })
    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the target user does not exist', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.user.findUnique.mockResolvedValue(null)
    const res = await call('ghost', { role: 'EDITOR' })
    expect(res.status).toBe(404)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('promotes a valid target and records the change → 200', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'writer-1',
      name: 'Wes',
      email: 'wes@consilium.test',
      role: 'READER',
    })
    prismaMock.user.update.mockResolvedValue({})
    const res = await call('writer-1', { role: 'EDITOR' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, oldRole: 'READER', newRole: 'EDITOR' })
    expect(prismaMock.user.update).toHaveBeenCalledOnce()
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce()
  })
})

// ── editorial/analytics: the authz conversion (raw session → helper) ─────────

describe('GET /api/editorial/analytics', () => {
  it('returns 401 when the caller lacks an analytics role', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await analyticsGET(
      nextJsonRequest('http://localhost/api/editorial/analytics?period=30d&tab=overview', 'GET')
    )
    expect(res.status).toBe(401)
    // Authorization must short-circuit before any data access.
    expect(prismaMock.article.findMany).not.toHaveBeenCalled()
  })
})

// ── upload: auth guard ────────────────────────────────────────────────────────

describe('POST /api/upload', () => {
  it('returns 403 for a caller without article-mutation rights', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await uploadPOST(nextJsonRequest('http://localhost/api/upload', 'POST'))
    expect(res.status).toBe(403)
  })
})

// ── user/streak: authz + cadence validation ──────────────────────────────────

describe('/api/user/streak', () => {
  it('GET returns 401 when unauthenticated', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await streakGET()
    expect(res.status).toBe(401)
  })

  it('GET returns a zero-state for a user with no streak row', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER)
    prismaMock.writerStreak.findUnique.mockResolvedValue(null)
    const res = await streakGET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.currentStreak).toBe(0)
    expect(body.intervalWeeks).toBe(1) // STREAK_INTERVAL_WEEKS.DEFAULT
  })

  it('PATCH rejects a non-integer intervalWeeks → 400', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER)
    const res = await streakPATCH(
      jsonRequest('http://localhost/api/user/streak', 'PATCH', { intervalWeeks: 'three' })
    )
    expect(res.status).toBe(400)
    expect(prismaMock.writerStreak.upsert).not.toHaveBeenCalled()
  })

  it('PATCH rejects an out-of-range intervalWeeks → 400', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER)
    const res = await streakPATCH(
      jsonRequest('http://localhost/api/user/streak', 'PATCH', { intervalWeeks: 99 })
    )
    expect(res.status).toBe(400)
    expect(prismaMock.writerStreak.upsert).not.toHaveBeenCalled()
  })

  it('PATCH persists a valid cadence and recomputes → 200', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER)
    prismaMock.writerStreak.upsert.mockResolvedValue({ id: 's1' })
    prismaMock.writerStreak.findUnique.mockResolvedValue({
      currentStreak: 3,
      longestStreak: 5,
      lastPublishedAt: null,
      intervalWeeks: 2,
    })
    const res = await streakPATCH(
      jsonRequest('http://localhost/api/user/streak', 'PATCH', { intervalWeeks: 2 })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).intervalWeeks).toBe(2)
    expect(prismaMock.writerStreak.upsert).toHaveBeenCalledOnce()
  })
})

// ── cron: secret enforcement wiring ──────────────────────────────────────────

describe('POST /api/cron/recalculate-streaks', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns 401 without an Authorization header', async () => {
    const res = await cronPOST(new Request('http://localhost/api/cron/recalculate-streaks', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(prismaMock.article.findMany).not.toHaveBeenCalled()
  })

  it('returns 401 with a wrong Bearer secret', async () => {
    const res = await cronPOST(
      new Request('http://localhost/api/cron/recalculate-streaks', {
        method: 'POST',
        headers: { Authorization: 'Bearer not-the-secret' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('runs with the correct Bearer secret → 200', async () => {
    prismaMock.article.findMany.mockResolvedValue([])
    const res = await cronPOST(
      new Request('http://localhost/api/cron/recalculate-streaks', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(0)
  })
})
