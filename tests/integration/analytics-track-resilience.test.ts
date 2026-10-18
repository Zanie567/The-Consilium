import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const collect = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analyticsCollector', () => ({ collectAnalytics: collect }))
import { POST } from '@/app/api/analytics/track/route'

const request = (sessionId: string) => new NextRequest('http://localhost/api/analytics/track', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.123' },
  body: JSON.stringify({ sessionId, articleId: 'article', activeSeconds: 0 }),
})
beforeEach(() => { vi.stubEnv('RATE_LIMIT_DISABLED', '0'); collect.mockReset(); collect.mockResolvedValue(undefined) })
afterEach(() => vi.unstubAllEnvs())
it('accepts more than 60 independent readers behind one university IP', async () => {
  const results = await Promise.all(Array.from({ length: 100 }, (_, n) => POST(request(`shared-ip-reader-${n}`))))
  expect(results.every(r => r.status === 200)).toBe(true)
  expect(collect).toHaveBeenCalledTimes(100)
})
it('still bounds repeated requests from one client, with an explicit retry response', async () => {
  const results = []
  for (let n = 0; n < 61; n++) results.push(await POST(request('one-noisy-client')))
  expect(results.filter(r => r.status === 200)).toHaveLength(60)
  expect(results.at(-1)?.status).toBe(429)
  expect(results.at(-1)?.headers.get('retry-after')).toBe('60')
  expect(collect).toHaveBeenCalledTimes(60)
})
it('reports persistence failure rather than falsely acknowledging an event', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  collect.mockRejectedValueOnce(new Error('private connection details'))
  try {
    const response = await POST(request('retryable-event'))
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(JSON.stringify(await response.json())).not.toContain('private')
    expect((await POST(request('retryable-event'))).status).toBe(200)
  } finally { log.mockRestore() }
})
it('drops malformed, oversize and bot events without querying the database', async () => {
  for (const body of ['null', '[]', '{}', '{', JSON.stringify({ sessionId: 'x'.repeat(5000) })]) {
    await POST(new NextRequest('http://localhost/api/analytics/track', {method:'POST',body}))
  }
  await POST(new NextRequest(request('bot'), { headers: { 'user-agent': 'Crawler' } }))
  expect(collect).not.toHaveBeenCalled()
})
