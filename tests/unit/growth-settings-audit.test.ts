import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {}, requireVerifiedSessionUser: vi.fn() }))
vi.mock('@/lib/testingMode', () => ({ auditTesting: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { siteSetting: { upsert: vi.fn() } } }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))

import { getServerSession } from 'next-auth'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { auditTesting } from '@/lib/testingMode'
import { prisma } from '@/lib/prisma'
import { PATCH } from '@/app/api/editorial/growth/settings/route'

const request = () => new Request('http://localhost:3200/api/editorial/growth/settings', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ linkedinUrl: 'https://www.linkedin.com/company/consilium/' }),
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TESTING_MODE_ENABLED', '1')
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: 'growth-persona', role: 'GROWTH' },
    testing: { id: 'testing-session', administratorId: 'real-administrator' },
  } as never)
  vi.mocked(requireVerifiedSessionUser).mockResolvedValue({ ok: true, user: { id: 'growth-persona', role: 'GROWTH' } } as never)
  vi.mocked(prisma.siteSetting.upsert).mockResolvedValue({} as never)
})
afterEach(() => vi.unstubAllEnvs())

it('records the actual successful outcome with real and effective identities, without payloads', async () => {
  const response = await PATCH(request())
  expect(response.status).toBe(200)
  expect(prisma.siteSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
    update: { value: 'https://www.linkedin.com/company/consilium/', updatedBy: 'growth-persona' },
  }))
  expect(auditTesting).toHaveBeenCalledExactlyOnceWith('real-administrator', 'growth-persona', 'testing:mutation-result', {
    sessionId: 'testing-session', method: 'PATCH', path: '/api/editorial/growth/settings', status: 200,
  })
})

it('records a denied outcome without persisting settings', async () => {
  vi.mocked(requireVerifiedSessionUser).mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) } as never)
  expect((await PATCH(request())).status).toBe(403)
  expect(prisma.siteSetting.upsert).not.toHaveBeenCalled()
  expect(auditTesting).toHaveBeenCalledExactlyOnceWith('real-administrator', 'growth-persona', 'testing:mutation-result', {
    sessionId: 'testing-session', method: 'PATCH', path: '/api/editorial/growth/settings', status: 403,
  })
})

it('keeps ordinary production requests free of testing audit lookups', async () => {
  vi.stubEnv('TESTING_MODE_ENABLED', '0')
  expect((await PATCH(request())).status).toBe(200)
  expect(getServerSession).not.toHaveBeenCalled()
  expect(auditTesting).not.toHaveBeenCalled()
  expect(prisma.siteSetting.upsert).toHaveBeenCalledOnce()
})
