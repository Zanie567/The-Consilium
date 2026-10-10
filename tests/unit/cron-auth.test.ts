import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { verifyCronAuth, verifyPublishCronAuth } from '@/lib/cronAuth'

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

// ── dedicated publishing secret ─────────────────────────────────────────────────────────────────
const LONG_PUBLISH = 'publish-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
const LONG_SHARED = 'shared-cron-secret-0123456789-abcdefghijklmnopqrstuvwxyz'

function restoreEnv(saved: { shared?: string; publish?: string }) {
  for (const [key, value] of [['CRON_SECRET', saved.shared], ['PUBLISH_CRON_SECRET', saved.publish]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('verifyPublishCronAuth (the publish route only)', () => {
  const saved = { shared: process.env.CRON_SECRET, publish: process.env.PUBLISH_CRON_SECRET }
  beforeEach(() => {
    process.env.CRON_SECRET = LONG_SHARED
    process.env.PUBLISH_CRON_SECRET = LONG_PUBLISH
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    restoreEnv(saved)
  })
  const bearer = (s: string) => reqWith({ authorization: `Bearer ${s}` })

  it('accepts the dedicated secret (what Supabase Cron sends)', () => {
    expect(verifyPublishCronAuth(bearer(LONG_PUBLISH), 't')).toBeNull()
    expect(verifyPublishCronAuth(reqWith({ 'x-cron-secret': LONG_PUBLISH }), 't')).toBeNull()
  })

  it('still accepts the shared CRON_SECRET (what GitHub Actions sends), so the transition needs no rotation', () => {
    expect(verifyPublishCronAuth(bearer(LONG_SHARED), 't')).toBeNull()
  })

  it('works before PUBLISH_CRON_SECRET exists in the environment: GitHub keeps publishing', () => {
    delete process.env.PUBLISH_CRON_SECRET
    expect(verifyPublishCronAuth(bearer(LONG_SHARED), 't')).toBeNull()
    expect(verifyPublishCronAuth(bearer(LONG_PUBLISH), 't')?.status).toBe(401)
  })

  it('rejects anything else with 401, including a near-miss and an empty Bearer', () => {
    for (const s of ['wrong', LONG_PUBLISH.slice(0, -1), LONG_PUBLISH + 'x', '']) {
      expect(verifyPublishCronAuth(bearer(s), 't')?.status).toBe(401)
    }
    expect(verifyPublishCronAuth(reqWith({}), 't')?.status).toBe(401)
  })

  it('fails closed (500) when neither secret is configured', () => {
    delete process.env.CRON_SECRET
    delete process.env.PUBLISH_CRON_SECRET
    expect(verifyPublishCronAuth(bearer(LONG_PUBLISH), 't')?.status).toBe(500)
  })

  it('ignores a dedicated secret that is too short to be safe, and says so', () => {
    process.env.PUBLISH_CRON_SECRET = 'short'
    expect(verifyPublishCronAuth(bearer('short'), 't')?.status).toBe(401)
    expect(verifyPublishCronAuth(bearer(LONG_SHARED), 't')).toBeNull()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('PUBLISH_CRON_SECRET'))
  })

  it('never writes either secret to the log', () => {
    verifyPublishCronAuth(bearer('nope'), 't')
    process.env.PUBLISH_CRON_SECRET = 'short'
    verifyPublishCronAuth(bearer('nope'), 't')
    for (const call of (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      const line = call.map(String).join(' ')
      expect(line).not.toContain(LONG_SHARED)
      expect(line).not.toContain(LONG_PUBLISH)
    }
  })
})

describe('the dedicated secret authorises publishing and nothing else', () => {
  const saved = { shared: process.env.CRON_SECRET, publish: process.env.PUBLISH_CRON_SECRET }
  beforeEach(() => {
    process.env.CRON_SECRET = LONG_SHARED
    process.env.PUBLISH_CRON_SECRET = LONG_PUBLISH
  })
  afterEach(() => restoreEnv(saved))

  it('verifyCronAuth, which every other cron route uses, rejects it (Bearer and x-cron-secret)', () => {
    expect(verifyCronAuth(reqWith({ authorization: `Bearer ${LONG_PUBLISH}` }), 't')?.status).toBe(401)
    expect(verifyCronAuth(reqWith({ 'x-cron-secret': LONG_PUBLISH }), 't')?.status).toBe(401)
  })

  it('PUBLISH_CRON_SECRET is read by exactly two modules: cronAuth and the publish route (no other route can accept it by accident)', () => {
    const root = join(process.cwd(), 'src')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(name)) files.push(p)
      }
    }
    walk(root)
    const mentioning = (needle: string) =>
      files.filter((f) => readFileSync(f, 'utf8').includes(needle)).map((f) => f.slice(root.length + 1)).sort()
    expect(mentioning('verifyPublishCronAuth')).toEqual(['app/api/publish-scheduled/route.ts', 'lib/cronAuth.ts'])
    expect(mentioning('PUBLISH_CRON_SECRET')).toEqual(['app/api/publish-scheduled/route.ts', 'lib/cronAuth.ts'])
  })
})
