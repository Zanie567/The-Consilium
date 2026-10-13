import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireVerifiedSessionUser: mocks.auth }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mocks.upload,
        remove: vi.fn(),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://local.test/${path}` } }),
      }),
    },
  }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { articleImageAsset: { create: mocks.create } } }))
// Simulates the production failure: the native library cannot be loaded.
vi.mock('sharp', () => {
  throw new Error('Could not load the "sharp" module using the linux-x64 runtime')
})

import { POST } from '@/app/api/upload/route'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function request(bucket: string) {
  const form = new FormData()
  form.set('bucket', bucket)
  form.set('file', new Blob([PNG_1X1], { type: 'image/png' }), 'pixel.png')
  return new NextRequest('http://localhost/api/upload', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'u1', role: 'WRITER' } })
  mocks.upload.mockResolvedValue({ error: null })
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55610')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only')
})

describe('upload route when the sharp native library cannot load', () => {
  it('fails article images with a clear 503, and writes no record or storage object', async () => {
    const res = await POST(request('article-images'))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/temporarily unavailable/i)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('still uploads avatars, which never need sharp', async () => {
    const res = await POST(request('avatars'))
    expect(res.status).toBe(201)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
  })
})
