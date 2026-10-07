import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

const resend = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: resend.send } } }))

import { sendEmail } from '@/lib/email'

const msg = { to: 'a@example.com', subject: 'Hello', html: '<p>x</p>' }

describe('sendEmail result', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  const savedTransport = process.env.EMAIL_TRANSPORT
  beforeEach(() => {
    // These tests exercise the Resend path, so they must not inherit capture mode from the e2e environment.
    delete process.env.EMAIL_TRANSPORT
    process.env.RESEND_API_KEY = 're_test'
    resend.send.mockReset()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    delete process.env.RESEND_API_KEY
    if (savedTransport === undefined) delete process.env.EMAIL_TRANSPORT
    else process.env.EMAIL_TRANSPORT = savedTransport
    errorSpy.mockRestore()
  })

  it('resolves true and forwards replyTo when Resend accepts the message', async () => {
    resend.send.mockResolvedValue({ data: { id: 'e1' }, error: null })
    await expect(sendEmail({ ...msg, replyTo: 'v@example.com' })).resolves.toBe(true)
    expect(resend.send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'v@example.com' }))
  })

  it('resolves false and logs when Resend returns { error } instead of throwing', async () => {
    resend.send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'domain not verified' } })
    await expect(sendEmail(msg)).resolves.toBe(false)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('resolves false when the SDK throws', async () => {
    resend.send.mockRejectedValue(new Error('network'))
    await expect(sendEmail(msg)).resolves.toBe(false)
  })

  it('resolves false when no API key is configured', async () => {
    delete process.env.RESEND_API_KEY
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sendEmail(msg)).resolves.toBe(false)
    warn.mockRestore()
  })
})
