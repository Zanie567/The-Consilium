import { describe, it, expect } from 'vitest'
import { assertIsolatedServiceEnv, isolatedServiceEnv } from '../../scripts/lib/testServices'

const good = () => isolatedServiceEnv({ appPort: 3200, storagePort: 54321, emailCaptureFile: '/tmp/outbox.jsonl' })

describe('isolated service environment for E2E', () => {
  it('the generated environment passes its own check', () => {
    expect(() => assertIsolatedServiceEnv(good())).not.toThrow()
  })

  it('points storage at loopback, captures email, and blanks every external credential', () => {
    const env = good()
    expect(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname).toBe('127.0.0.1')
    expect(env.EMAIL_TRANSPORT).toBe('capture')
    for (const key of ['RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRED_API_KEY', 'ALPHA_VANTAGE_API_KEY']) {
      expect(env[key], key).toBe('')
    }
  })

  it('refuses a production storage URL', () => {
    expect(() => assertIsolatedServiceEnv({ ...good(), NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' })).toThrow(/not loopback/)
  })

  it('refuses a real email key, or email not captured', () => {
    expect(() => assertIsolatedServiceEnv({ ...good(), RESEND_API_KEY: 're_live_key' })).toThrow(/RESEND_API_KEY/)
    expect(() => assertIsolatedServiceEnv({ ...good(), EMAIL_TRANSPORT: undefined })).toThrow(/EMAIL_TRANSPORT/)
    expect(() => assertIsolatedServiceEnv({ ...good(), EMAIL_CAPTURE_FILE: undefined })).toThrow(/EMAIL_CAPTURE_FILE/)
  })

  it('refuses Google OAuth credentials and a missing launcher marker', () => {
    expect(() => assertIsolatedServiceEnv({ ...good(), GOOGLE_CLIENT_ID: 'x' })).toThrow(/Google/)
    expect(() => assertIsolatedServiceEnv({ ...good(), E2E_ISOLATED: undefined })).toThrow(/E2E_ISOLATED/)
  })

  it('refuses a bare environment (what a plain `playwright test` would have)', () => {
    expect(() => assertIsolatedServiceEnv({})).toThrow(/not isolated/)
  })
})
