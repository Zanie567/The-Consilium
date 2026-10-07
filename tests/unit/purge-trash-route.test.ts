/**
 * POST /api/cron/purge-trash: the explicit, reported, audited trash purge.
 * Pairs with trash-purge.test.ts (the library) and publish-scheduled-no-purge.test.ts
 * (publishing must no longer delete anything).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { purgeMock, revalidateMock } = vi.hoisted(() => ({
  purgeMock: vi.fn(),
  revalidateMock: vi.fn(),
}))
vi.mock('@/lib/trashPurge', () => ({ purgeExpiredTrash: purgeMock }))
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: revalidateMock }))

import * as route from '@/app/api/cron/purge-trash/route'

const SECRET = 'test-secret-value-that-is-long-enough-0123456789'
const URL_BASE = 'https://www.theconsilium.co.uk/api/cron/purge-trash'

const req = (init: { auth?: boolean; query?: string; method?: string } = {}) =>
  new Request(`${URL_BASE}${init.query ?? ''}`, {
    method: init.method ?? 'POST',
    headers: init.auth === false ? {} : { authorization: `Bearer ${SECRET}` },
  })

const result = (over: Record<string, unknown> = {}) => ({
  ranAt: '2026-10-07T00:08:52.000Z',
  retentionDays: 30,
  cutoff: '2026-09-07T00:08:52.000Z',
  dryRun: false,
  count: 0,
  articleIds: [],
  articles: [],
  wouldPurge: [],
  errors: [],
  ...over,
})

let originalSecret: string | undefined
beforeEach(() => {
  vi.resetAllMocks()
  originalSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = SECRET
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalSecret
  vi.restoreAllMocks()
})

describe('purge-trash route: access', () => {
  it('rejects a request without the cron secret and purges nothing', async () => {
    const res = await route.POST(req({ auth: false }))
    expect(res.status).toBe(401)
    expect(purgeMock).not.toHaveBeenCalled()
  })

  it('exposes POST only, so a prefetch or link-preview GET can never delete data', () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined()
  })
})

describe('purge-trash route: reporting', () => {
  it('always reports the purge outcome, even when nothing was purged', async () => {
    purgeMock.mockResolvedValue(result())
    const res = await route.POST(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.purged).toEqual({ count: 0, articleIds: [], articles: [] })
    expect(body.retentionDays).toBe(30)
    expect(body.cutoff).toBe('2026-09-07T00:08:52.000Z')
    expect(body.dryRun).toBe(false)
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('reports the exact ids removed and refreshes public caches', async () => {
    const articles = [{ id: 'a', title: 'T', slug: 's', deletedAt: '2026-08-01T00:00:00.000Z' }]
    purgeMock.mockResolvedValue(result({ count: 1, articleIds: ['a'], articles }))
    const res = await route.POST(req())
    const body = await res.json()
    expect(body.purged).toEqual({ count: 1, articleIds: ['a'], articles })
    expect(revalidateMock).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('a'))
  })

  it('?dryRun=1 deletes nothing and lists what would be purged', async () => {
    const would = [{ id: 'a', title: 'T', slug: 's', deletedAt: '2026-08-01T00:00:00.000Z' }]
    purgeMock.mockResolvedValue(result({ dryRun: true, wouldPurge: would }))
    const res = await route.POST(req({ query: '?dryRun=1' }))
    expect(purgeMock).toHaveBeenCalledWith({ dryRun: true })
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.purged.count).toBe(0)
    expect(body.wouldPurge).toEqual(would)
  })

  it('without the flag it is a real run', async () => {
    purgeMock.mockResolvedValue(result())
    await route.POST(req())
    expect(purgeMock).toHaveBeenCalledWith({ dryRun: false })
  })
})

describe('purge-trash route: failures are visible to the scheduler', () => {
  it('returns 500 (so the Actions run fails) when any article could not be purged, still reporting what was', async () => {
    purgeMock.mockResolvedValue(
      result({ count: 1, articleIds: ['b'], articles: [], errors: [{ articleId: 'a', message: 'connection reset' }] }),
    )
    const res = await route.POST(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.errors).toEqual([{ articleId: 'a', message: 'connection reset' }])
    expect(body.purged.articleIds).toEqual(['b'])
    expect(console.error).toHaveBeenCalled()
  })

  it('returns 500 with a reference, not a raw database error, when the job throws', async () => {
    purgeMock.mockRejectedValue(new Error('P1001: password authentication failed for user "postgres"'))
    const res = await route.POST(req())
    expect(res.status).toBe(500)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('password')
    expect(text).toContain('purge-trash')
    expect(console.error).toHaveBeenCalled()
  })
})
