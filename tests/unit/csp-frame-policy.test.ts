import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function productionHeaders() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.resetModules()
  const { default: settings } = await import('../../next.config')
  const rules = (await settings.headers?.()) ?? []
  const all = rules.find((rule) => rule.source === '/(.*)')?.headers ?? []
  const get = (key: string) => all.find((h) => h.key === key)?.value
  const csp = get('Content-Security-Policy') ?? ''
  const directives = Object.fromEntries(
    csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/)
      return [name, values]
    }),
  )
  return { get, directives }
}

describe('frame policy for the Trading Challenge registration embed', () => {
  it('lets the site embed only Google Forms (plus itself)', async () => {
    const { directives } = await productionHeaders()
    expect(directives['frame-src']).toEqual(["'self'", 'https://docs.google.com'])
  })

  it('does not allow any wildcard or scheme-wide frame source', async () => {
    const { directives } = await productionHeaders()
    for (const source of directives['frame-src']) {
      expect(source).not.toMatch(/\*|^https?:$|^data:|^blob:/)
    }
  })

  it('still forbids every other site from framing The Consilium', async () => {
    const { get, directives } = await productionHeaders()
    expect(directives['frame-ancestors']).toEqual(["'none'"])
    expect(get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it('keeps the rest of the existing policy intact', async () => {
    const { get, directives } = await productionHeaders()
    expect(directives['default-src']).toEqual(["'self'"])
    expect(directives['script-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(directives['script-src']).not.toContain("'unsafe-eval'")
    expect(directives['connect-src']).toEqual(["'self'", 'https:'])
    expect(get('X-Content-Type-Options')).toBe('nosniff')
    expect(get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })
})
