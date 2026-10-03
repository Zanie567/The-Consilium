import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const resend = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: resend.send } } }))

import { sendEmail } from '@/lib/email'

describe('sendEmail transport', () => {
  const file = path.join(os.tmpdir(), `outbox-${process.pid}.jsonl`)
  afterEach(() => {
    delete process.env.EMAIL_TRANSPORT
    delete process.env.EMAIL_CAPTURE_FILE
    delete process.env.RESEND_API_KEY
    fs.rmSync(file, { force: true })
    resend.send.mockClear()
  })

  it('capture mode writes the message to the file and NEVER calls the provider, even with a real key set', async () => {
    process.env.EMAIL_TRANSPORT = 'capture'
    process.env.EMAIL_CAPTURE_FILE = file
    process.env.RESEND_API_KEY = 're_would_be_live'
    await sendEmail({ to: 'a@example.com', subject: 'Hello', html: '<p>x</p>' })
    expect(resend.send).not.toHaveBeenCalled()
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ to: 'a@example.com', subject: 'Hello', html: '<p>x</p>' })
  })

  it('capture mode without a file drops the email rather than falling back to sending', async () => {
    process.env.EMAIL_TRANSPORT = 'capture'
    process.env.RESEND_API_KEY = 're_would_be_live'
    await sendEmail({ to: 'a@example.com', subject: 'Hello', html: '<p>x</p>' })
    expect(resend.send).not.toHaveBeenCalled()
  })

  it('sends through the provider when not capturing and a key is set', async () => {
    process.env.RESEND_API_KEY = 're_test'
    await sendEmail({ to: 'a@example.com', subject: 'Hello', html: '<p>x</p>' })
    expect(resend.send).toHaveBeenCalledOnce()
  })
})
