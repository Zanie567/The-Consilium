import { afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'local' }))
// Confirmation mail is captured, never sent.
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => true) }))
import { POST } from '@/app/api/subscribe/route'
const email = `${randomUUID()}@example.test`
const legacyEmails: string[] = []
const request = (value: unknown) =>
  new NextRequest('http://localhost/api/subscribe', {
    method: 'POST',
    body: JSON.stringify({ email: value }),
  })
afterAll(async () => {
  await prisma.subscriber.deleteMany({ where: { email: { in: [email, ...legacyEmails] } } })
})
describe('newsletter persistence', () => {
  it.each(['', 'bad', 'a@b', 'x'.repeat(255) + '@a.test'])('rejects invalid %s', async (value) =>
    expect((await POST(request(value))).status).toBe(400)
  )
  it('normalizes and deduplicates concurrent/repeated sign-ups, answering every one identically', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => POST(request(`  ${email.toUpperCase()}  `)))
    )
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202, 202, 202, 202])
    expect(new Set(await Promise.all(responses.map((r) => r.text()))).size).toBe(1)
    expect(await prisma.subscriber.count({ where: { email } })).toBe(1)
    // A sign-up is only a request: nothing is subscribed until the emailed link is confirmed.
    expect((await prisma.subscriber.findFirst({ where: { email } }))?.status).toBe('PENDING')
  })
  it.each(['\t', '\n', ' ', '﻿'])('reuses historical subscribers with surrounding %j whitespace', async whitespace => {
    const address = `${randomUUID()}@example.test`
    const stored = `${whitespace}${address.toUpperCase()}${whitespace}`
    legacyEmails.push(stored, address)
    await prisma.subscriber.create({ data: { email: stored } })
    expect((await POST(request(address))).status).toBe(202)
    await expect(prisma.subscriber.create({ data: { email: address } })).rejects.toThrow()
  })
  it('returns a friendly failure without database details', async () => {
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('secret database failure'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(request('failed@example.test'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret')
    spy.mockRestore()
  })
})
