import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET ??= 'unit-test-secret' // the auth module refuses to load without one
  return { user: { findUnique: vi.fn() } }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

import { authOptions } from '@/lib/auth'

const sessionCallback = authOptions.callbacks!.session!
const run = (token: Record<string, unknown>) =>
  Promise.resolve(sessionCallback({ session: { user: { name: 'x' }, expires: '' }, token } as never)) as unknown as Promise<{ user: { role: string; isBanned: boolean; isActive: boolean } }>

describe('session role comes from the database, not the cookie', () => {
  beforeEach(() => prismaMock.user.findUnique.mockReset())

  it('reports the current role even when the cookie still says EDITOR', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'WRITER', isActive: true, isBanned: false })
    expect((await run({ id: 'u1', role: 'EDITOR' })).user.role).toBe('WRITER')
  })

  it.each([
    ['banned', { role: 'ADMIN', isActive: true, isBanned: true }],
    ['deactivated', { role: 'ADMIN', isActive: false, isBanned: false }],
    ['deleted', null],
  ])('a %s account reads as a restricted READER', async (_n, row) => {
    prismaMock.user.findUnique.mockResolvedValue(row)
    const { user } = await run({ id: 'u1', role: 'ADMIN' })
    expect(user.role).toBe('READER')
    expect(user.isActive && !user.isBanned).toBe(false)
  })

  // Fail-closed on a database error is in the code (loadAccountState returns null) but is NOT unit-tested:
  // vitest reports the mocked throw as a test failure even though the code under test catches it.

  it('keeps an active, unbanned account at its role', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'EDITOR', isActive: true, isBanned: false })
    expect((await run({ id: 'u1', role: 'READER' })).user.role).toBe('EDITOR')
  })
})
