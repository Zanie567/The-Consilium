import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireVerifiedSessionUser: mocks.auth }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mocks.upload,
        remove: mocks.remove,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://local.test/${path}` } }),
      }),
    },
  }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { articleImageAsset: { create: vi.fn().mockResolvedValue({}) } } }))
import { POST } from '@/app/api/upload/route'
async function request(bytes: Uint8Array, type = 'image/png') {
  const form = new FormData()
  form.set('bucket', 'article-images')
  form.set('file', new Blob([Buffer.from(bytes)], { type }), 'chart.png')
  return new NextRequest('http://localhost/api/upload', { method: 'POST', body: form })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'writer', role: 'WRITER' } })
  mocks.upload.mockResolvedValue({ error: null })
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55610')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only')
})
describe('article image upload content, size, ownership and failures', () => {
  it('decodes a valid chart and returns dimensions; duplicate filenames produce unique owned objects', async () => {
    const png = await sharp({
      create: { width: 1200, height: 600, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer()
    const first = await POST(await request(png))
    const second = await POST(await request(png))
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await first.json()).toMatchObject({ width: 1200, height: 600 })
    const paths = mocks.upload.mock.calls.map((call) => call[0])
    expect(paths[0]).toMatch(/^writer\/[a-f0-9-]{36}\.png$/)
    expect(paths[0]).not.toBe(paths[1])
  })
  // An oversize file is 413 Payload Too Large (the route's contract, shared with avatars and the
  // client's size message); every other unusable file is a 400.
  it.each([
    ['empty', new Uint8Array(), 400],
    ['large', new Uint8Array(4 * 1024 * 1024 + 1), 413],
    ['damaged', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 400],
    ['spoofed', new TextEncoder().encode('<script>danger</script>'), 400],
  ])('rejects %s content before storage', async (_label, bytes, status) => {
    expect((await POST(await request(bytes))).status).toBe(status)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('rejects mismatched declared MIME', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    expect((await POST(await request(png, 'image/jpeg'))).status).toBe(400)
  })
  it('keeps Growth/reader out of article-image uploads', async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: 'growth', role: 'GROWTH' } })
    expect((await POST(await request(new Uint8Array([1])))).status).toBe(403)
  })
  it('returns friendly provider failure without internal errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.upload.mockResolvedValue({ error: { message: 'private bucket database detail' } })
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    const res = await POST(await request(png))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('private bucket')
    log.mockRestore()
  })
})
