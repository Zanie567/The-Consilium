/**
 * Server-side authorisation for the editorial calendar.
 *
 * The calendar is gated by CALENDAR_ACCESS_ROLES (src/lib/rbac.ts), which is
 * ADMIN-only. The gate is enforced in two independent places and both are
 * covered here, because hiding the nav link is not access control:
 *
 *   - the page (src/app/editorial/(portal)/calendar/page.tsx) calls notFound()
 *   - the move API (PATCH /api/editorial/calendar) returns 403
 *
 * These are role tests, not shape tests: if someone widens the constant to let
 * editors in, the ALLOW cases still pass and the DENY cases fail loudly, which
 * is exactly the signal that change should produce.
 *
 * Runs against a live server and skips (does not fail) when none is reachable,
 * matching the other live suites here. Seeded accounts come from
 * `npm run test:setup-db`.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Session, serverUp } from './helpers/http'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@theconsilium.com', password: process.env.E2E_ADMIN_PASSWORD ?? 'consilium2024' }
const WRITER = { email: 'writer@theconsilium.com', password: 'writer2024' }

let up = false
let admin: Session
let writer: Session
let adminOk = false
let writerOk = false

beforeAll(async () => {
  up = await serverUp(BASE)
  if (!up) {
    console.warn(`[calendar-access] No server at ${BASE} — skipping.`)
    return
  }
  admin = new Session(BASE)
  writer = new Session(BASE)
  ;[adminOk, writerOk] = await Promise.all([
    admin.login(ADMIN.email, ADMIN.password),
    writer.login(WRITER.email, WRITER.password),
  ])
})

describe('editorial calendar authorisation', () => {
  it('serves the calendar page to an admin', async () => {
    if (!up || !adminOk) return
    const res = await admin.get('/editorial/calendar')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Editorial Calendar')
  })

  it('does not serve the calendar page to a writer', async () => {
    if (!up || !writerOk) return
    const res = await writer.get('/editorial/calendar')
    expect(res.status).toBe(404)

    const html = await res.text()
    expect(html).toMatch(/not found/i)
    // Assert on the calendar's own content, not on the string "Editorial
    // Calendar": Next resolves the segment's metadata title before notFound()
    // wins, so that phrase survives in the flight payload as a discarded title
    // candidate. What must never appear is the calendar UI or any article it
    // would have listed.
    for (const marker of [
      'UNSCHEDULED',
      'Scheduled and published work',
      'Busy day',
      'data-calendar-day',
    ]) {
      expect(html, `writer 404 leaked calendar marker: ${marker}`).not.toContain(marker)
    }
  })

  it('rejects an anonymous move request with 401', async () => {
    if (!up) return
    const res = await fetch(`${BASE}/api/editorial/calendar`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articleId: 'nonexistent', date: '2026-09-10' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects a writer move request with 403', async () => {
    if (!up || !writerOk) return
    const res = await writer.patch('/api/editorial/calendar', {
      articleId: 'nonexistent',
      date: '2026-09-10',
    })
    expect(res.status).toBe(403)
  })

  it('lets an admin past the role gate (404 for a missing article, not 403)', async () => {
    if (!up || !adminOk) return
    const res = await admin.patch('/api/editorial/calendar', {
      articleId: 'definitely-not-a-real-article-id',
      date: '2026-09-10',
    })
    // Passing the gate and failing the lookup is the proof the gate allowed us.
    expect(res.status).toBe(404)
  })

  it('validates the move payload for an authorised caller', async () => {
    if (!up || !adminOk) return
    for (const bad of [
      { articleId: 'x', date: '10-09-2026' },
      { articleId: 'x', date: '2026-02-30' },
      { articleId: '', date: '2026-09-10' },
    ]) {
      const res = await admin.patch('/api/editorial/calendar', bad)
      expect(res.status).toBe(400)
    }
  })
})
