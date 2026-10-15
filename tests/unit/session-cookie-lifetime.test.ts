/**
 * The real NextAuth session endpoint, with a controlled clock: what a returning browser actually gets back.
 * Only the database is mocked. The cookie is encrypted with the real `next-auth/jwt` encoder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const prismaMock = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'unit-test-secret-for-session-lifetime'
  process.env.NEXTAUTH_URL = 'https://www.theconsilium.co.uk'
  return { user: { findUnique: vi.fn(), update: vi.fn() } }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

import { encode } from 'next-auth/jwt'
// next-auth's package exports hide ./core; it is the session handler the App Router route wraps unchanged.
import { AuthHandler } from '../../node_modules/next-auth/core/index.js'
import { authOptions, credentialStamp } from '@/lib/auth'

const DAY = 24 * 60 * 60 * 1000
const COOKIE = '__Secure-next-auth.session-token' // NEXTAUTH_URL is https, as in production
const T0 = new Date('2026-11-01T09:00:00Z')
const PASSWORD = '$2a$10$current-hash'

async function signedInCookie(credential = credentialStamp('u1', PASSWORD)) {
  // As issued at sign-in by the jwt callback.
  return encode({
    token: { id: 'u1', sub: 'u1', role: 'WRITER', email: 'kai@ed.ac.uk', credential, roleCheckedAt: Date.now(), bannedCheckedAt: Date.now(), activeCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: 60 * 24 * 60 * 60,
  })
}

type OutCookie = { name: string; value: string; options: { expires?: Date; httpOnly?: boolean; sameSite?: string; secure?: boolean; path?: string; domain?: string; maxAge?: number } }

/** GET /api/auth/session as the route handler runs it (the route only adapts Next's request to this call). */
async function readSession(cookie: string) {
  const res = await AuthHandler({
    req: { method: 'GET', action: 'session', query: {}, body: undefined, cookies: { [COOKIE]: cookie }, headers: { host: 'www.theconsilium.co.uk' } },
    options: authOptions,
  } as never)
  const body = (res.body ?? {}) as { user?: Record<string, unknown> }
  const ours = ((res.cookies ?? []) as OutCookie[]).filter((c) => c.name === COOKIE)
  const renewed = ours.find((c) => c.value && c.options.maxAge !== 0)
  const cleared = ours.some((c) => !c.value || c.options.maxAge === 0)
  return { body, renewed, cleared, value: renewed?.value }
}

describe('session cookie lifetime (real NextAuth endpoint, controlled clock)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    prismaMock.user.findUnique.mockReset()
    prismaMock.user.findUnique.mockResolvedValue({ role: 'WRITER', isActive: true, isBanned: false, password: PASSWORD })
  })
  afterEach(() => vi.useRealTimers())

  it('is a persistent, protected cookie that expires 60 days after the last renewal', async () => {
    const { body, renewed } = await readSession(await signedInCookie())
    expect(body.user).toMatchObject({ id: 'u1', role: 'WRITER' })
    expect(renewed!.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    expect(renewed!.options.domain).toBeUndefined() // host-only: www.theconsilium.co.uk, never shared with other hosts
    // A persistent cookie (an Expires date), so closing the browser does not end it.
    expect(renewed!.options.expires!.getTime()).toBe(T0.getTime() + 60 * DAY)
  })

  it('a visit on day 59 is still signed in and pushes expiry 60 days past that visit', async () => {
    const cookie = await signedInCookie()
    vi.setSystemTime(new Date(T0.getTime() + 59 * DAY))
    const { body, renewed, value } = await readSession(cookie)
    expect(body.user?.id).toBe('u1')
    expect(renewed!.options.expires!.getTime()).toBe(T0.getTime() + 119 * DAY)
    // And the renewed cookie still works on day 100 (41 days after the renewal).
    vi.setSystemTime(new Date(T0.getTime() + 100 * DAY))
    expect((await readSession(value!)).body.user?.id).toBe('u1')
  })

  it('after 61 days without a visit the browser is signed out', async () => {
    const cookie = await signedInCookie()
    vi.setSystemTime(new Date(T0.getTime() + 61 * DAY))
    const { body, renewed } = await readSession(cookie)
    expect(body.user).toBeUndefined()
    expect(renewed).toBeUndefined()
  })

  it('a password reset signs out every existing session and clears the cookie', async () => {
    const cookie = await signedInCookie()
    prismaMock.user.findUnique.mockResolvedValue({ role: 'WRITER', isActive: true, isBanned: false, password: '$2a$10$after-reset' })
    const { body, renewed, cleared } = await readSession(cookie)
    expect(body.user).toBeUndefined()
    expect(renewed).toBeUndefined()
    expect(cleared).toBe(true)
  })

  it('a suspended account keeps no permissions even with a valid cookie', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN', isActive: true, isBanned: true, password: PASSWORD })
    const { body } = await readSession(await signedInCookie())
    expect(body.user).toMatchObject({ role: 'READER', isBanned: true })
  })

  it('a cookie signed with a different secret is rejected (a rotated secret signs everyone out)', async () => {
    const foreign = await encode({ token: { id: 'u1', role: 'ADMIN' }, secret: 'some-other-secret', maxAge: 60 * 24 * 60 * 60 })
    const { body, cleared } = await readSession(foreign)
    expect(body.user).toBeUndefined()
    expect(cleared).toBe(true)
  })
})
