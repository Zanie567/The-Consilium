/**
 * Retired article addresses: path matching, the per-instance redirect cache, and the proxy's permanent,
 * server-side 301 (src/lib/articleRedirects.ts, src/proxy.ts).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { resolve } = vi.hoisted(() => ({ resolve: vi.fn<(slug: string) => Promise<string | null>>() }))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
vi.mock('@/lib/articleRedirects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/articleRedirects')>()),
  resolveArticleRedirect: resolve,
}))

import { articleSlugFromPath, createRedirectResolver, findArticleRedirect, loadArticleRedirectMap } from '@/lib/articleRedirects'
import { proxy } from '@/proxy'

const MAPPING = new Map([
  ['draft-1791210392433', 'will-si-stocks-make-you-rich-in-2026'],
  ['draft-1785172614450', 'tulip-mania-lessons-from-the-17th-century'],
])

beforeEach(() => {
  resolve.mockReset()
  resolve.mockImplementation(async (slug) => MAPPING.get(slug) ?? null)
})

describe('articleSlugFromPath', () => {
  it('matches /articles/<slug> only', () => {
    expect(articleSlugFromPath('/articles/draft-1791210392433')).toBe('draft-1791210392433')
    expect(articleSlugFromPath('/articles/tulip-mania/')).toBe('tulip-mania')
    expect(articleSlugFromPath('/articles')).toBeNull()
    expect(articleSlugFromPath('/articles/a/b')).toBeNull()
    expect(articleSlugFromPath('/api/articles/abc')).toBeNull()
    expect(articleSlugFromPath('/articles/%E0%A4%A')).toBeNull()
  })
})

describe('proxy: retired addresses answer 301 before any page code runs', () => {
  it('redirects permanently (301) to the current address, keeping the query string', async () => {
    const res = await proxy(new NextRequest('https://www.theconsilium.co.uk/articles/draft-1791210392433?utm_source=x'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://www.theconsilium.co.uk/articles/will-si-stocks-make-you-rich-in-2026?utm_source=x')
  })

  it('also for HEAD and with a trailing slash', async () => {
    const res = await proxy(new NextRequest('https://www.theconsilium.co.uk/articles/draft-1785172614450/', { method: 'HEAD' }))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://www.theconsilium.co.uk/articles/tulip-mania-lessons-from-the-17th-century')
  })

  it('passes current addresses, unknown addresses and other paths through untouched', async () => {
    for (const path of ['/articles/tulip-mania-lessons-from-the-17th-century', '/articles/never-existed', '/about', '/api/articles/draft-1791210392433']) {
      const res = await proxy(new NextRequest(`https://www.theconsilium.co.uk${path}`))
      expect(res.status, path).not.toBe(301)
      expect(res.headers.get('x-middleware-next'), path).toBe('1')
    }
  })

  it('never redirects a state-changing request', async () => {
    const res = await proxy(new NextRequest('https://www.theconsilium.co.uk/articles/draft-1791210392433', { method: 'POST' }))
    expect(res.status).not.toBe(301)
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('createRedirectResolver', () => {
  it('reads the table once per TTL window and serves lookups from memory', async () => {
    let t = 0
    const load = vi.fn(async () => MAPPING)
    const lookup = createRedirectResolver(load, 60_000, () => t)
    expect(await lookup('draft-1791210392433')).toBe('will-si-stocks-make-you-rich-in-2026')
    expect(await lookup('tulip-mania')).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
    t = 61_000
    await lookup('draft-1791210392433')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one read between concurrent first requests', async () => {
    const load = vi.fn(async () => MAPPING)
    const lookup = createRedirectResolver(load, 60_000, () => 0)
    await Promise.all([lookup('a'), lookup('b'), lookup('c')])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a database failure never throws; it keeps the last good map and retries soon', async () => {
    let t = 0
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockResolvedValueOnce(MAPPING).mockRejectedValueOnce(new Error('db down')).mockResolvedValue(new Map())
    const lookup = createRedirectResolver(load, 60_000, () => t)
    await lookup('x')
    t = 61_000
    expect(await lookup('draft-1785172614450')).toBe('tulip-mania-lessons-from-the-17th-century')
    t = 61_000 + 4_000
    await lookup('x')
    expect(load).toHaveBeenCalledTimes(2)
    t = 61_000 + 6_000
    await lookup('x')
    expect(load).toHaveBeenCalledTimes(3)
    error.mockRestore()
  })
})

describe('only public articles are redirect targets', () => {
  it('loadArticleRedirectMap and findArticleRedirect filter through the site visibility rule', async () => {
    const findMany = vi.fn(async () => [{ oldSlug: 'draft-1', article: { slug: 'new-1' } }])
    const findFirst = vi.fn(async () => null)
    const db = { articleSlugRedirect: { findMany, findFirst } } as never
    expect([...(await loadArticleRedirectMap(db))]).toEqual([['draft-1', 'new-1']])
    expect(await findArticleRedirect('draft-1', db)).toBeNull()
    for (const call of [findMany.mock.calls[0], findFirst.mock.calls[0]] as unknown as { where: { article: Record<string, unknown> } }[][]) {
      expect(call[0].where.article).toMatchObject({ status: 'PUBLISHED', deletedAt: null })
    }
  })
})
