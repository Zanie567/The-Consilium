/**
 * Proxy (Next.js 16 middleware) authorization-contract tests.
 *
 * These import the real `proxy()` from `src/proxy.ts` with `getToken` mocked to
 * an anonymous (null) session and assert the public/protected API surface at the
 * edge. They lock the contract that regressed once already: the anonymous
 * PUBLISHED article list (`GET /api/articles`) must reach its handler, while
 * sensitive routes are rejected with 401 before any handler runs.
 *
 * The in-process handler tests deliberately bypass middleware, so without this
 * file the proxy — the app's front-line authorization layer — has no coverage.
 */

import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))

import { proxy } from '@/proxy'

function get(path: string) {
  return proxy(new NextRequest(`http://localhost${path}`, { method: 'GET' }))
}

// NextResponse.next() carries this header; a 401 JSON or a redirect does not.
const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1'

describe('proxy() — anonymous API access', () => {
  it('lets the public PUBLISHED article list through to its handler', async () => {
    const res = await get('/api/articles')
    expect(res.status).not.toBe(401)
    expect(passedThrough(res)).toBe(true)
  })

  it('lets /api/articles?status=DRAFT reach the handler (role gate is handler-side)', async () => {
    // pathname is `/api/articles` regardless of query string, so the edge lets
    // it pass; the route handler enforces the DRAFT role check.
    expect(passedThrough(await get('/api/articles?status=DRAFT'))).toBe(true)
  })

  it('lets a single article and its sub-paths through', async () => {
    expect(passedThrough(await get('/api/articles/abc123'))).toBe(true)
    expect(passedThrough(await get('/api/articles/abc123/comments'))).toBe(true)
  })

  it('keeps real public prefixes public (exact and segment matches)', async () => {
    expect(passedThrough(await get('/api/team'))).toBe(true)
    expect(passedThrough(await get('/api/team/42'))).toBe(true)
    expect(passedThrough(await get('/api/ticker/markets'))).toBe(true)
    expect(passedThrough(await get('/api/search?q=ai'))).toBe(true)
  })

  it.each([
    '/api/editorial/analytics?period=30d&tab=overview',
    '/api/editorial/users',
    '/api/editorial/trash',
    '/api/admin/users',
    '/api/analytics/by-author',
    '/api/user/streak',
  ])('rejects sensitive route %s with 401', async (path) => {
    expect((await get(path)).status).toBe(401)
  })

  it('does not leak a sibling path via a loose prefix match', async () => {
    // `/api/team-secrets` starts with the string `/api/team` but is not a
    // `/api/team/...` sub-path, so segment matching must NOT treat it as public.
    expect((await get('/api/team-secrets')).status).toBe(401)
  })
})
