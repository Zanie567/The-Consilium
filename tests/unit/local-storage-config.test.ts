import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function config(storage: string, imageFlag: string, harness: string) {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', storage)
  vi.stubEnv('NEXT_IMAGE_ALLOW_LOCAL_STORAGE', imageFlag)
  vi.stubEnv('TEST_HARNESS', harness)
  vi.resetModules()
  const { default: settings } = await import('../../next.config')
  const headers = await settings.headers?.()
  const csp = headers?.[0].headers.find(header => header.key === 'Content-Security-Policy')?.value
  return { settings, csp }
}

describe('local Storage image verification boundary', () => {
  it('allows only the exact loopback origin with both test flags', async () => {
    const { settings, csp } = await config('http://127.0.0.1:55491/storage', '1', '1')
    expect(settings.images?.dangerouslyAllowLocalIP).toBe(true)
    expect(csp).toContain("img-src 'self' data: blob: https: http://127.0.0.1:55491;")
    expect(csp).toContain("connect-src 'self' https:;")
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it.each([
    ['http://127.0.0.1:55491', '', '1'],
    ['http://127.0.0.1:55491', '1', ''],
    ['http://storage.example.test:55491', '1', '1'],
    ['http://user:password@localhost:55491', '1', '1'],
    ['ftp://localhost:55491', '1', '1'],
  ])('keeps production CSP for %s with image=%s harness=%s', async (url, flag, harness) => {
    const { settings, csp } = await config(url, flag, harness)
    expect(csp).toContain("img-src 'self' data: blob: https:;")
    expect(csp).not.toContain('http:')
    if (!harness && flag === '1') {
      // Preserve existing optimizer allowance independently of the new CSP flag.
      expect(settings.images?.dangerouslyAllowLocalIP).toBe(true)
    } else {
      expect(settings.images?.dangerouslyAllowLocalIP).toBe(false)
    }
  })
})
