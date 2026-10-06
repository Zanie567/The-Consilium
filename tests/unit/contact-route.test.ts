import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { contactMessage: { create: mocks.create } } }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => '127.0.0.1' }))
// Keep the real template builders; only the transport is mocked.
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: mocks.sendEmail,
}))

import { POST } from '@/app/api/contact/route'
import { CONTACT_EMAIL } from '@/lib/constants'

function request(body: unknown) {
  return new NextRequest('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const valid = {
  name: 'Ada Lovelace',
  email: 'Ada@Example.com',
  subject: 'feedback',
  message: 'Hello there',
}

describe('POST /api/contact', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue({ id: 'm1' })
    mocks.sendEmail.mockReset().mockResolvedValue(true)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errorSpy.mockRestore())

  it('saves the message, then emails the editors and awaits the send', async () => {
    let finished = false
    mocks.sendEmail.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      finished = true
      return true
    })

    const res = await POST(request(valid))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.create).toHaveBeenCalledWith({
      data: { name: 'Ada Lovelace', email: 'ada@example.com', subject: 'feedback', message: 'Hello there' },
    })
    expect(mocks.sendEmail).toHaveBeenCalledOnce()
    // The response must not resolve before the send does (serverless freezes un-awaited work).
    expect(finished).toBe(true)
    const arg = mocks.sendEmail.mock.calls[0][0]
    expect(arg.to).toBe(CONTACT_EMAIL)
    expect(arg.replyTo).toBe('ada@example.com')
    expect(arg.html).toContain('Hello there')
  })

  it('escapes user input in the body and keeps it out of the subject', async () => {
    const hostile = {
      name: '<script>alert(1)</script>',
      email: 'a@example.com',
      subject: 'x\r\nBcc: evil@example.com',
      message: '<img src=x onerror=alert(1)> & "quotes"',
    }

    const res = await POST(request(hostile))

    expect(res.status).toBe(200)
    const { subject, html } = mocks.sendEmail.mock.calls[0][0]
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;')
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).not.toContain('evil')
    expect(subject).not.toContain('script')
  })

  it('still succeeds for the visitor, and logs, when sendEmail reports failure', async () => {
    mocks.sendEmail.mockResolvedValue(false)

    const res = await POST(request(valid))

    expect(res.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('still succeeds for the visitor, and logs, when sendEmail throws', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('boom'))

    const res = await POST(request(valid))

    expect(res.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('returns 500 and sends nothing when the database save fails', async () => {
    mocks.create.mockRejectedValue(new Error('db down'))

    const res = await POST(request(valid))

    expect(res.status).toBe(500)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    ['missing field', { ...valid, message: '' }],
    ['bad email', { ...valid, email: 'not-an-email' }],
    ['overlong name', { ...valid, name: 'a'.repeat(101) }],
    ['overlong message', { ...valid, message: 'a'.repeat(5001) }],
  ])('rejects invalid input (%s) with 400, saving and sending nothing', async (_label, body) => {
    const res = await POST(request(body))

    expect(res.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })
})
