import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => ({ id: 'verified-account' })) }))
vi.mock('@/lib/testingMode', () => ({
  requireTestingWorkspace: vi.fn(async () => {}),
  resolveTestingIdentity: vi.fn(async () => null),
  auditTesting: vi.fn(async () => {}),
  TESTING_COOKIE: 'consilium-testing',
}))
import { resolveTestingIdentity, auditTesting } from '@/lib/testingMode'
import { proxy } from '@/proxy'

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('TESTING_MODE_ENABLED', '1'); vi.mocked(resolveTestingIdentity).mockResolvedValue(null) })
afterEach(() => vi.unstubAllEnvs())
function request(cookie?: string) {
  return new NextRequest('http://localhost:3200/api/articles/owned', {
    method: 'PUT', headers: { host: 'localhost:3200', origin: 'http://localhost:3200', 'x-consilium-identity': 'old-page-identity', ...(cookie ? { cookie: `consilium-testing=${cookie}` } : {}) },
  })
}

it('a server-restricted ordinary account gets an account denial and never reaches its mutation', async () => {
  const response = await proxy(request())
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ code: 'ACCOUNT_RESTRICTED', error: expect.stringMatching(/suspended.*inactive.*Contact an administrator/) })
  expect(response.headers.get('x-middleware-next')).toBeNull()
  expect(auditTesting).not.toHaveBeenCalled()
})

it('a stale capability remains a 409 even when its real account is restricted', async () => {
  const response = await proxy(request('expired-or-revoked'))
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'TESTING_IDENTITY_CHANGED' })
  expect(response.headers.get('x-middleware-next')).toBeNull()
})

it('the restored ordinary identity still has to match its exact page revision', async () => {
  vi.mocked(resolveTestingIdentity).mockResolvedValue({ administrator: { id: 'verified-account', testingRevision: 1 }, effective: { id: 'verified-account' }, testing: null } as never)
  expect((await proxy(request())).status).toBe(409)
  const restored = request()
  restored.headers.set('x-consilium-identity', 'verified-account:1:normal')
  const response = await proxy(restored)
  expect(response.headers.get('x-middleware-next')).toBe('1')
  expect(response.headers.get('x-middleware-request-x-consilium-verified-identity')).toBe('verified-account:1:normal')
})
