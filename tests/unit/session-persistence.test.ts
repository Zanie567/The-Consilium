import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET ??= 'unit-test-secret' // the auth module refuses to load without one
  return { user: { findUnique: vi.fn(), update: vi.fn() } }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

import { authOptions, credentialStamp, SESSION_MAX_AGE_S, SESSION_RENEW_AFTER_S, SessionRevokedError } from '@/lib/auth'

const jwt = authOptions.callbacks!.jwt!
const session = authOptions.callbacks!.session!
const row = (over: Record<string, unknown> = {}) => ({ role: 'WRITER', isActive: true, isBanned: false, password: '$2a$10$hash-one', ...over })

describe('session lifetime', () => {
  it('is a rolling 60 days, renewed after a day', () => {
    expect(authOptions.session).toMatchObject({ strategy: 'jwt', maxAge: 60 * 24 * 60 * 60 })
    expect(SESSION_MAX_AGE_S).toBe(5_184_000)
    expect(SESSION_RENEW_AFTER_S).toBe(86_400)
    // updateAge has no effect on JWT sessions; it must not suggest otherwise.
    expect(authOptions.session).not.toHaveProperty('updateAge')
  })

  it('tells the browser when to renew, from the cookie issue time', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row())
    const out = await session({ session: { user: {}, expires: '' }, token: { id: 'u1', role: 'WRITER', iat: 1_000_000 } } as never)
    expect((out as { renewAt?: number }).renewAt).toBe((1_000_000 + 86_400) * 1000)
  })

  it('a cookie from the old 24-hour configuration is renewed on the next visit', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row())
    const legacy = await session({ session: { user: {}, expires: '' }, token: { id: 'u1', role: 'WRITER', iat: 1_000_000, exp: 1_000_000 + 86_400 } } as never)
    expect((legacy as { renewAt?: number }).renewAt).toBe(1_000_000 * 1000)
    const current = await session({ session: { user: {}, expires: '' }, token: { id: 'u1', role: 'WRITER', iat: 1_000_000, exp: 1_000_000 + SESSION_MAX_AGE_S } } as never)
    expect((current as { renewAt?: number }).renewAt).toBe((1_000_000 + 86_400) * 1000)
  })
})

describe('credential stamp: a password change ends existing sessions', () => {
  beforeEach(() => prismaMock.user.findUnique.mockReset())

  it('is stamped at sign-in, and is not the password hash', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row())
    const token = await jwt({ token: {}, user: { id: 'u1', role: 'WRITER' }, account: { provider: 'credentials' } } as never)
    expect(token.credential).toBe(credentialStamp('u1', '$2a$10$hash-one'))
    expect(JSON.stringify(token)).not.toContain('hash-one')
  })

  it('a later read with the same password keeps the session', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row())
    const token = { id: 'u1', role: 'WRITER', credential: credentialStamp('u1', '$2a$10$hash-one'), roleCheckedAt: Date.now(), bannedCheckedAt: Date.now(), activeCheckedAt: Date.now() }
    await expect(jwt({ token } as never)).resolves.toMatchObject({ id: 'u1' })
  })

  it('a reset or changed password signs the old session out', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ password: '$2a$10$hash-two' }))
    const token = { id: 'u1', role: 'WRITER', credential: credentialStamp('u1', '$2a$10$hash-one') }
    await expect(jwt({ token } as never)).rejects.toBeInstanceOf(SessionRevokedError)
  })

  it('a deleted account is signed out', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    await expect(jwt({ token: { id: 'gone', role: 'ADMIN', credential: 'x' } } as never)).rejects.toBeInstanceOf(SessionRevokedError)
  })

  it('a cookie issued before stamps existed adopts the current stamp instead of signing everyone out', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row())
    const token = await jwt({ token: { id: 'u1', role: 'WRITER' } } as never)
    expect(token.credential).toBe(credentialStamp('u1', '$2a$10$hash-one'))
  })

  it('a Google-only account (no password) has a stable stamp that setting a password changes', () => {
    expect(credentialStamp('u1', null)).toBe(credentialStamp('u1', null))
    expect(credentialStamp('u1', null)).not.toBe(credentialStamp('u1', '$2a$10$new'))
    expect(credentialStamp('u1', '$2a$10$x')).not.toBe(credentialStamp('u2', '$2a$10$x'))
  })
})

describe('suspension and role changes still apply on the next read, not at expiry', () => {
  it.each([
    ['suspended', row({ role: 'ADMIN', isBanned: true })],
    ['deactivated', row({ role: 'ADMIN', isActive: false })],
  ])('a %s account reads as a restricted READER', async (_n, state) => {
    prismaMock.user.findUnique.mockResolvedValue(state)
    const out = await session({ session: { user: {}, expires: '' }, token: { id: 'u1', role: 'ADMIN' } } as never) as { user: { role: string } }
    expect(out.user.role).toBe('READER')
  })

  it('a demotion takes effect although the cookie still says EDITOR', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ role: 'READER' }))
    const out = await session({ session: { user: {}, expires: '' }, token: { id: 'u1', role: 'EDITOR' } } as never) as { user: { role: string } }
    expect(out.user.role).toBe('READER')
  })
})
