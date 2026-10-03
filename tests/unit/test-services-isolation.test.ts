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

  it('rejects missing blank overrides, which Next could fill from production env files', () => {
    for (const key of ['RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRED_API_KEY', 'ALPHA_VANTAGE_API_KEY']) {
      expect(() => assertIsolatedServiceEnv({ ...good(), [key]: undefined }), key).toThrow(key)
    }
  })

  it('rejects real storage credentials and remote auth/site URLs', () => {
    for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      expect(() => assertIsolatedServiceEnv({ ...good(), [key]: 'production-key' }), key).toThrow(key)
    }
    expect(() => assertIsolatedServiceEnv({ ...good(), NEXTAUTH_URL: 'https://theconsilium.co.uk' })).toThrow('NEXTAUTH_URL')
    expect(() => assertIsolatedServiceEnv({ ...good(), NEXT_PUBLIC_SITE_URL: undefined })).toThrow('NEXT_PUBLIC_SITE_URL')
  })

  it('rejects invalid and overlapping local service ports', () => {
    for (const port of [NaN, 0, 65536, 3200.5]) {
      expect(() => isolatedServiceEnv({ appPort: port, storagePort: 54321, emailCaptureFile: '/tmp/outbox' })).toThrow(/ports/)
    }
    expect(() => isolatedServiceEnv({ appPort: 3200, storagePort: 3200, emailCaptureFile: '/tmp/outbox' })).toThrow(/separate/)
  })

  it('allows per-run builds but refuses arbitrary build paths', () => {
    expect(() => assertIsolatedServiceEnv({ ...good(), NEXT_DIST_DIR: '.next-e2e-3320-1234' })).not.toThrow()
    for (const value of ['.next', '/tmp/other', '../.next-e2e', '.next-e2e/a']) {
      expect(() => assertIsolatedServiceEnv({ ...good(), NEXT_DIST_DIR: value })).toThrow('NEXT_DIST_DIR')
    }
  })
})
