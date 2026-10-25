/**
 * Security contract for src/proxy.ts, written before the proxy was trimmed for Vercel CPU
 * (perf/vercel-hobby-resource-optimisation). Every behaviour here existed before that work and
 * must survive it: sign-in redirects, 401s on private APIs, banned-reader redirects, the
 * same-origin check on state-changing API calls, stripping a browser-supplied identity
 * attestation, and the testing-workspace gate.
 *
 * `getToken` is mocked so each case can be anonymous, signed in, banned or carrying a
 * session cookie that does not decode (getToken rejects; the proxy must treat it as signed out).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'

const testingModule = vi.hoisted(() => ({ loads: 0 }))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }))
vi.mock('@/lib/testingMode', () => {
  testingModule.loads += 1
  return {
    requireTestingWorkspace: vi.fn(async () => { throw new Error('not attested') }),
    resolveTestingIdentity: vi.fn(async () => null),
    auditTesting: vi.fn(async () => {}),
    TESTING_COOKIE: 'consilium-testing',
  }
})

import { getToken } from 'next-auth/jwt'
import { config, proxy } from '@/proxy'

const ORIGIN = 'http://localhost:3200'
type Token = Awaited<ReturnType<typeof getToken>>
const signedIn = (extra: Record<string, unknown> = {}) => ({ id: 'user-1', role: 'WRITER', ...extra }) as unknown as Token

function call(path: string, init: { method?: string; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: 'localhost:3200', ...init.headers }
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN
  return proxy(new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers }))
}
const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1'
const redirectedTo = (res: Response) => {
  const location = res.headers.get('location')
  return location ? new URL(location).pathname : null
}

beforeEach(() => {
  vi.mocked(getToken).mockReset()
  vi.mocked(getToken).mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

// Runs first: the testing-gate test below loads the module on purpose.
describe('module loading', () => {
  it('does not load the testing-mode module (and its database client) when testing mode is off', async () => {
    for (const path of ['/', '/editorial', '/api/admin/stats', '/api/comments']) await call(path)
    vi.mocked(getToken).mockResolvedValue(signedIn({ isBanned: true }))
    await call('/articles/x')
    expect(testingModule.loads).toBe(0)
  })
})

describe('signed-out visitors', () => {
  it.each(['/editorial', '/editorial/articles', '/admin', '/admin/team', '/dashboard'])('are sent to /login from %s', async (path) => {
    expect(redirectedTo(await call(path))).toBe('/login')
  })

  it.each(['/editorial/login', '/editorial/reset-password', '/editorial/setup', '/login', '/reset-password'])('can open %s', async (path) => {
    expect(passedThrough(await call(path))).toBe(true)
  })

  it.each(['/', '/articles/some-article', '/category/news', '/tag/ai', '/author/abc', '/archive', '/privacy'])('can read public page %s', async (path) => {
    expect(passedThrough(await call(path))).toBe(true)
  })

  it.each([
    ['GET', '/api/admin/stats'],
    ['GET', '/api/editorial/users'],
    ['POST', '/api/upload'],
    ['GET', '/api/profile/account'],
    ['POST', '/api/bookmarks'],
    ['GET', '/api/teams'], // sibling of the public /api/team prefix
  ])('get 401 from %s %s', async (method, path) => {
    expect((await call(path, { method })).status).toBe(401)
  })

  it('are treated as signed out when the session cookie cannot be decoded', async () => {
    vi.mocked(getToken).mockRejectedValue(new Error('JWEDecryptionFailed'))
    expect(redirectedTo(await call('/editorial'))).toBe('/login')
    expect((await call('/api/admin/stats')).status).toBe(401)
    expect(passedThrough(await call('/articles/some-article'))).toBe(true)
  })
})

describe('signed-in readers and staff', () => {
  it('reach protected areas; the role check stays with each page and handler', async () => {
    vi.mocked(getToken).mockResolvedValue(signedIn())
    expect(passedThrough(await call('/editorial'))).toBe(true)
    expect(passedThrough(await call('/api/admin/stats'))).toBe(true)
  })

  it('cannot forge the server-owned identity attestation on any route', async () => {
    vi.mocked(getToken).mockResolvedValue(signedIn({ role: 'ADMIN' }))
    for (const path of ['/editorial', '/articles/x', '/api/editorial/users', '/api/auth/session']) {
      const res = await call(path, { headers: { 'x-consilium-verified-identity': 'forged-admin' } })
      expect(passedThrough(res)).toBe(true)
      expect(res.headers.get('x-middleware-request-x-consilium-verified-identity')).toBeNull()
    }
  })
})

describe('banned accounts', () => {
  beforeEach(() => { vi.mocked(getToken).mockResolvedValue(signedIn({ isBanned: true })) })

  it.each(['/', '/articles/some-article', '/editorial', '/profile'])('are redirected from %s to /banned', async (path) => {
    expect(redirectedTo(await call(path))).toBe('/banned')
  })

  it.each(['/banned', '/login', '/api/auth/session'])('can still open %s', async (path) => {
    expect(passedThrough(await call(path))).toBe(true)
  })

  it('are not redirected on API calls (the handlers answer for themselves)', async () => {
    expect(redirectedTo(await call('/api/articles'))).toBeNull()
  })
})

describe('state-changing API requests (CSRF)', () => {
  beforeEach(() => { vi.mocked(getToken).mockResolvedValue(signedIn()) })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s from another origin is refused', async (method) => {
    expect((await call('/api/comments', { method, origin: 'https://evil.example' })).status).toBe(403)
  })

  it('a malformed Origin is refused', async () => {
    expect((await call('/api/comments', { method: 'POST', origin: 'not a url' })).status).toBe(403)
  })

  it('same-origin writes pass', async () => {
    expect(passedThrough(await call('/api/comments', { method: 'POST' }))).toBe(true)
  })

  it('anonymous cross-origin writes to public endpoints are still refused', async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    expect((await call('/api/analytics/track', { method: 'POST', origin: 'https://evil.example' })).status).toBe(403)
    expect((await call('/api/subscribe', { method: 'POST', origin: 'https://evil.example' })).status).toBe(403)
  })

  it('NextAuth routes keep their own CSRF handling', async () => {
    expect(passedThrough(await call('/api/auth/callback/credentials', { method: 'POST', origin: 'https://evil.example' }))).toBe(true)
  })

  it('cron routes stay reachable without a session (each checks its own secret)', async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    expect(passedThrough(await call('/api/publish-scheduled', { method: 'POST', origin: null, headers: { authorization: 'Bearer x' } }))).toBe(true)
    expect(passedThrough(await call('/api/cron/scheduler-health', { method: 'POST', origin: null }))).toBe(true)
  })
})

describe('testing workspace gate', () => {
  it('refuses every proxied request when testing mode is on but the workspace is not attested', async () => {
    vi.stubEnv('TESTING_MODE_ENABLED', '1')
    const res = await call('/articles/some-article')
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'TESTING_UNAVAILABLE' })
  })
})

describe('matcher', () => {
  const matches = (path: string, method = 'GET', headers: Record<string, string> = {}) =>
    unstable_doesMiddlewareMatch({ config, url: path, headers: { ...headers, 'x-method': method } })

  it.each([
    '/', '/articles/some-article', '/category/news', '/editorial', '/editorial/articles/abc/edit',
    '/admin', '/dashboard', '/login', '/banned', '/api/admin/stats', '/api/upload', '/api/auth/session',
    // Paths with file extensions under private prefixes must never skip the proxy.
    '/api/admin/stats.png', '/api/x.json', '/editorial/a.png', '/admin/export.csv', '/api/teams/x.svg',
  ])('runs the proxy for %s', (path) => {
    expect(matches(path)).toBe(true)
  })

  it('runs the proxy for Server Action posts to pages', () => {
    expect(matches('/articles/some-article', 'POST', { 'next-action': 'abc123' })).toBe(true)
    expect(matches('/editorial/articles/abc/edit', 'POST', { 'next-action': 'abc123' })).toBe(true)
  })

  it.each(['/_next/static/chunks/main.js', '/_next/image', '/favicon.ico'])('skips Next internals: %s', (path) => {
    expect(matches(path)).toBe(false)
  })

  it.each([
    '/logo.png', '/favicon-navy-32.png', '/apple-touch-icon.png', '/apple-icon.png', '/icon.png',
    '/robots.txt', '/sitemap.xml', '/feed.xml', '/next.svg', '/brand/consilium-mark-v2.png',
    '/og/consilium-share-v2.png', '/team/yaoqing-wang.jpeg',
  ])('skips the public asset file %s', (path) => {
    expect(matches(path)).toBe(false)
  })

  it.each([
    '/team', '/team/', '/teams/x.png', '/brand/sub/x.png', '/og/x.png/edit',
    '/api%2Fadmin%2Fstats.png', '/logo.png/extra', '/.well-known/security.txt', '/x.php', '/xmlrpc.php',
  ])('still runs the proxy for the near-miss %s', (path) => {
    expect(matches(path)).toBe(true)
  })
})
