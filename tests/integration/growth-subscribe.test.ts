import { afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'local' }))
import { POST } from '@/app/api/subscribe/route'
const email = `${randomUUID()}@example.test`
const request = (value: unknown) =>
  new NextRequest('http://localhost/api/subscribe', {
    method: 'POST',
    body: JSON.stringify({ email: value }),
  })
afterAll(async () => {
  await prisma.subscriber.deleteMany({ where: { email } })
})
describe('newsletter persistence', () => {
  it.each(['', 'bad', 'a@b', 'x'.repeat(255) + '@a.test'])('rejects invalid %s', async (value) =>
    expect((await POST(request(value))).status).toBe(400)
  )
  it('normalizes and deduplicates concurrent/repeated subscriptions', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => POST(request(`  ${email.toUpperCase()}  `)))
    )
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201])
    expect(await prisma.subscriber.count({ where: { email } })).toBe(1)
  })
  it('returns a friendly failure without database details', async () => {
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('secret database failure'))
    const response = await POST(request('failed@example.test'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret')
    spy.mockRestore()
  })
})
