import { beforeEach, describe, expect, it, vi } from 'vitest'

const { create, sendEmail } = vi.hoisted(() => ({ create: vi.fn(), sendEmail: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { contactMessage: { create } } }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => '1.2.3.4' }))
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email')>('@/lib/email')
  return { ...actual, sendEmail }
})

import { POST } from '@/app/api/contact/route'
import { CONTACT_EMAIL } from '@/lib/constants'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/contact', { method: 'POST', body: JSON.stringify(body) }) as never)

const valid = { name: 'Ada', email: 'Ada@Example.com', subject: 'story', message: 'Hello <b>there</b>' }

describe('POST /api/contact', () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({})
    sendEmail.mockReset().mockResolvedValue(true)
  })

  it('stores the message and emails the editor inbox with the visitor as reply-to', async () => {
    const res = await post(valid)
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledOnce()
    expect(sendEmail).toHaveBeenCalledOnce()
    const arg = sendEmail.mock.calls[0][0]
    expect(arg.to).toBe(CONTACT_EMAIL)
    expect(arg.replyTo).toBe('ada@example.com')
    expect(arg.subject).toContain('Story tip')
    expect(arg.html).not.toContain('<b>there</b>')
  })

  it('still succeeds when the notification email fails, since the message is saved', async () => {
    sendEmail.mockResolvedValue(false)
    expect((await post(valid)).status).toBe(200)
    expect(create).toHaveBeenCalledOnce()
  })

  it('sends nothing for invalid input', async () => {
    expect((await post({ ...valid, email: 'nope' })).status).toBe(400)
    expect(create).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
