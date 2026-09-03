import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { NextAuthOptions } from 'next-auth'

/**
 * Regression tests for the NextAuth `redirect` callback.
 *
 * NextAuth passes the raw `callbackUrl` query parameter (and the
 * `next-auth.callback-url` cookie) straight into this callback without
 * validating it first, so the callback is the only thing standing between an
 * attacker-supplied URL and a post-sign-in navigation.
 *
 * The security property asserted throughout: whatever the callback returns must
 * parse to the base origin. Each denial case therefore checks the origin of the
 * result, not just its string value.
 */

// src/lib/auth.ts throws at module load without NEXTAUTH_SECRET and pulls in the
// Prisma client and email transport. None of that is needed to exercise a pure
// URL comparison, so they are stubbed and the module is imported lazily.
process.env.NEXTAUTH_SECRET = 'test-nextauth-secret'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), passwordResetEmail: vi.fn() }))
vi.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }))

const BASE_URL = 'https://www.theconsilium.co.uk'

let redirect: NonNullable<NonNullable<NextAuthOptions['callbacks']>['redirect']>

beforeAll(async () => {
  const { authOptions } = await import('@/lib/auth')
  redirect = authOptions.callbacks!.redirect!
})

const resolve = (url: string) =>
  Promise.resolve(redirect({ url, baseUrl: BASE_URL })) as Promise<string>

/** True when navigating to `result` would stay on the application's origin. */
function staysOnOrigin(result: string): boolean {
  try {
    return new URL(result, BASE_URL).origin === BASE_URL
  } catch {
    return false
  }
}

describe('authOptions.callbacks.redirect', () => {
  describe('allows same-origin targets', () => {
    it.each([
      ['root', '/', `${BASE_URL}/`],
      ['relative path', '/editorial', `${BASE_URL}/editorial`],
      ['relative path with query', '/articles?page=2', `${BASE_URL}/articles?page=2`],
      ['relative path with fragment', '/articles#section', `${BASE_URL}/articles#section`],
      ['absolute same-origin URL', `${BASE_URL}/profile`, `${BASE_URL}/profile`],
      // Host case and the default :443 are normalised by the URL parser, so
      // these remain same-origin rather than being rejected as lookalikes.
      ['mixed-case host', 'https://WWW.ThEcOnSiLiUm.Co.Uk/editorial', `${BASE_URL}/editorial`],
      ['explicit default port', `https://www.theconsilium.co.uk:443/profile`, `${BASE_URL}/profile`],
    ])('%s', async (_label, input, expected) => {
      expect(await resolve(input)).toBe(expected)
    })
  })

  describe('rejects everything that resolves off-origin', () => {
    const denied: ReadonlyArray<readonly [string, string]> = [
      // The original defect: a prefix test accepts any host beginning with the
      // base URL, and `.evil.example` is a different registrable domain.
      ['lookalike suffix host', 'https://www.theconsilium.co.uk.evil.example/'],
      ['lookalike apex host', 'https://theconsilium.co.uk.evil.example/'],
      ['lookalike with path', 'https://www.theconsilium.co.uk.evil.example/login'],
      ['suffix host with no dot', 'https://www.theconsilium.co.ukevil.example/'],
      // The base origin sits in the userinfo component; the real host is
      // evil.example. A prefix test accepts this too.
      ['userinfo confusion', 'https://www.theconsilium.co.uk@evil.example/'],
      ['userinfo confusion, apex', 'https://theconsilium.co.uk@evil.example/'],
      ['unrelated origin', 'https://evil.example/'],
      ['protocol-relative', '//evil.example/'],
      ['protocol-relative lookalike', '//www.theconsilium.co.uk.evil.example/'],
      ['scheme downgrade', 'http://www.theconsilium.co.uk/editorial'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['data scheme', 'data:text/html,<script>alert(1)</script>'],
      ['backslash authority', '\\\\evil.example/'],
      ['percent-encoded dot in host', 'https://www.theconsilium.co.uk%2Eevil.example/'],
      ['non-default port', `${BASE_URL}:8443/editorial`],
      ['trailing-dot hostname', 'https://www.theconsilium.co.uk./editorial'],
      ['malformed URL', 'http://['],
    ]

    it.each(denied)('rejects %s', async (_label, input) => {
      const result = await resolve(input)
      expect(result).toBe(BASE_URL)
      expect(staysOnOrigin(result)).toBe(true)
    })
  })

  it('never returns an off-origin target for any input in the matrix', async () => {
    const inputs = [
      '/', '/editorial', `${BASE_URL}/x`,
      'https://www.theconsilium.co.uk.evil.example/',
      'https://www.theconsilium.co.uk@evil.example/',
      '//evil.example/', 'javascript:alert(1)', 'data:text/html,x',
      'http://www.theconsilium.co.uk/x', 'http://[', '',
    ]
    for (const input of inputs) {
      expect(staysOnOrigin(await resolve(input))).toBe(true)
    }
  })
})
