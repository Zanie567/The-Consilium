import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }))
import { getToken } from 'next-auth/jwt'
import { proxy } from '@/proxy'

const call = (method: string, path: string) =>
  proxy(new NextRequest(`http://localhost:3200${path}`, { method, headers: { host: 'localhost:3200', origin: 'http://localhost:3200' } }))

beforeEach(() => { vi.mocked(getToken).mockResolvedValue(null) })

// Anyone locked out of the editorial portal is, by definition, signed out.
it.each(['POST', 'PATCH'])('lets a signed-out visitor %s /api/editorial/password-reset', async (method) => {
  const response = await call(method, '/api/editorial/password-reset')
  expect(response.status).not.toBe(401)
})

it('still refuses cross-origin writes to the public reset route', async () => {
  const response = await proxy(new NextRequest('http://localhost:3200/api/editorial/password-reset', {
    method: 'POST', headers: { host: 'localhost:3200', origin: 'https://evil.example' },
  }))
  expect(response.status).toBe(403)
})

it.each([
  ['GET', '/api/editorial/users'],
  ['POST', '/api/editorial/articles'],
  ['POST', '/api/editorial/password-reset-extra'],
  ['POST', '/api/editorial/password-reset/anything'],
])('keeps %s %s behind a session', async (method, path) => {
  expect((await call(method, path)).status).toBe(401)
})
