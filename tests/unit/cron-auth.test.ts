import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyCronAuth } from '@/lib/cronAuth'

const SECRET = 'test-cron-secret-value'

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/cron/x', { method: 'POST', headers })
}

describe('verifyCronAuth', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.CRON_SECRET
    process.env.CRON_SECRET = SECRET
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })

  it('authorises a valid Bearer token (returns null)', () => {
    expect(verifyCronAuth(reqWith({ authorization: `Bearer ${SECRET}` }), 't')).toBeNull()
  })

  it('authorises a valid x-cron-secret header (returns null)', () => {
    expect(verifyCronAuth(reqWith({ 'x-cron-secret': SECRET }), 't')).toBeNull()
  })

  it('authorises a valid x-cron-secret even when a WRONG Bearer is also present', () => {
    // Regression: `provided = bearer || headerSecret` let a non-empty bad Bearer
    // mask a valid x-cron-secret. Both headers must be checked independently.
    const res = verifyCronAuth(
      reqWith({ authorization: 'Bearer wrong-token', 'x-cron-secret': SECRET }),
      't',
    )
    expect(res).toBeNull()
  })

  it('rejects when both headers are present but both wrong (401)', () => {
    const res = verifyCronAuth(
      reqWith({ authorization: 'Bearer nope', 'x-cron-secret': 'also-nope' }),
      't',
    )
    expect(res?.status).toBe(401)
  })

  it('rejects when no secret header is supplied (401)', () => {
    expect(verifyCronAuth(reqWith({}), 't')?.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET
    expect(verifyCronAuth(reqWith({ 'x-cron-secret': SECRET }), 't')?.status).toBe(500)
  })
})
