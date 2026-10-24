/**
 * Sign-up confirmation (and preference-link) mail uses the EXISTING transactional configuration
 * (src/lib/email.ts, RESEND_API_KEY, noreply@ sender) and works whether or not newsletter (marketing)
 * delivery has been enabled. The Resend SDK is mocked: nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const sdk = vi.hoisted(() => ({ keys: [] as string[], sent: [] as Record<string, unknown>[] }))
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function (this: unknown, key: string) {
    sdk.keys.push(key)
    return { emails: { send: vi.fn(async (payload: Record<string, unknown>) => { sdk.sent.push(payload); return { data: { id: 'email_1' }, error: null } }) } }
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => '203.0.113.9' }))
vi.mock('@/lib/newsletter/subscriptions', () => ({
  requestSubscription: vi.fn(async ({ email }: { email: string }) => ({
    outcome: 'confirmation_sent',
    mail: { to: email, subject: 'Confirm your subscription to The Consilium', html: '<a href="https://www.theconsilium.co.uk/newsletter/confirm?token=x">Confirm</a>' },
  })),
}))
const providerSpy = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/lib/newsletter/provider', async (original) => {
  const actual = await original<typeof import('@/lib/newsletter/provider')>()
  return { ...actual, getMarketingProvider: () => { providerSpy.calls++; return actual.getMarketingProvider() } }
})

import { POST as subscribe } from '@/app/api/subscribe/route'
import { resolveDelivery } from '@/lib/newsletter/config'

/** A production server process: no test flags, transactional key present, marketing delivery OFF. */
function productionLike(extra: Record<string, string> = {}) {
  vi.stubEnv('VITEST', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('TESTING_MODE_ENABLED', '0')
  vi.stubEnv('EMAIL_TRANSPORT', '')
  vi.stubEnv('E2E_ISOLATED', '')
  vi.stubEnv('TEST_HARNESS', '')
  vi.stubEnv('RESEND_API_KEY', 're_transactional_key')
  vi.stubEnv('NEWSLETTER_DELIVERY', '')
  vi.stubEnv('RESEND_MARKETING_API_KEY', '')
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v)
}

const request = (email: string) => new NextRequest('https://www.theconsilium.co.uk/api/subscribe', { method: 'POST', body: JSON.stringify({ email }) })

beforeEach(() => {
  sdk.keys.length = 0
  sdk.sent.length = 0
  providerSpy.calls = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('confirmation mail is transactional', () => {
  it('is sent with RESEND_API_KEY from noreply@ while newsletter delivery is disabled', async () => {
    productionLike()
    expect(resolveDelivery().mode).toBe('disabled')
    const res = await subscribe(request('reader@example.com'))
    expect(res.status).toBe(202)
    expect(sdk.keys).toEqual(['re_transactional_key'])
    expect(sdk.sent).toEqual([expect.objectContaining({ to: 'reader@example.com', from: 'The Consilium <noreply@theconsilium.co.uk>', subject: expect.stringMatching(/Confirm/) })])
    expect(providerSpy.calls).toBe(0) // the marketing path is never consulted
  })

  it('still uses the transactional key, never the marketing key, once newsletter delivery is enabled', async () => {
    productionLike({
      NEWSLETTER_DELIVERY: 'resend',
      RESEND_MARKETING_API_KEY: 're_marketing_key',
      RESEND_NEWSLETTER_SEGMENT_ID: 'seg',
      RESEND_TOPIC_WEEKLY_ID: 'tw',
      RESEND_TOPIC_ALERTS_ID: 'ta',
      NEXT_PUBLIC_SITE_URL: 'https://www.theconsilium.co.uk',
    })
    expect(resolveDelivery().mode).toBe('resend')
    await subscribe(request('reader2@example.com'))
    expect(sdk.keys).toEqual(['re_transactional_key'])
    expect(sdk.sent).toHaveLength(1)
    expect(providerSpy.calls).toBe(0)
  })

  it('in any test process the link mail is captured or dropped, never sent with a real key', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_should_never_be_used')
    vi.stubEnv('EMAIL_TRANSPORT', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await subscribe(request('reader3@example.com'))
    expect(sdk.keys).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/link mail dropped/))
    warn.mockRestore()
  })
})
