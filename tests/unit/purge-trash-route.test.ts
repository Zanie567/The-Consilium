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

  const SECRET_TITLE = 'Unpublished Draft: Confidential Title'
  const SECRET_SLUG = 'unpublished-draft-confidential-slug'
  const full = [{ id: 'a', title: SECRET_TITLE, slug: SECRET_SLUG, deletedAt: '2026-08-01T00:00:00.000Z' }]

  it('reports the exact ids removed and refreshes public caches', async () => {
    purgeMock.mockResolvedValue(result({ count: 1, articleIds: ['a'], articles: full }))
    const res = await route.POST(req())
    const body = await res.json()
    expect(body.purged).toEqual({
      count: 1,
      articleIds: ['a'],
      articles: [{ id: 'a', deletedAt: '2026-08-01T00:00:00.000Z' }],
    })
    expect(revalidateMock).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('a'))
  })

  // This repository is PUBLIC, so GitHub Actions logs are world-readable and the workflow
  // prints the response body. Titles and slugs of deleted (possibly unpublished) articles
  // belong in audit_logs, never in the HTTP response.
  it('never puts article titles or slugs in the response (it lands in a public Actions log)', async () => {
    purgeMock.mockResolvedValue(result({ count: 1, articleIds: ['a'], articles: full, dryRun: false }))
    const text = JSON.stringify(await (await route.POST(req())).json())
    expect(text).not.toContain(SECRET_TITLE)
    expect(text).not.toContain(SECRET_SLUG)
    purgeMock.mockResolvedValue(result({ dryRun: true, wouldPurge: full }))
    const dry = JSON.stringify(await (await route.POST(req({ query: '?dryRun=1' }))).json())
    expect(dry).not.toContain(SECRET_TITLE)
    expect(dry).not.toContain(SECRET_SLUG)
  })

  it('?dryRun=1 deletes nothing and lists what would be purged (ids only)', async () => {
    purgeMock.mockResolvedValue(result({ dryRun: true, wouldPurge: full }))
    const res = await route.POST(req({ query: '?dryRun=1' }))
    expect(purgeMock).toHaveBeenCalledWith({ dryRun: true })
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.purged.count).toBe(0)
    expect(body.wouldPurge).toEqual([{ id: 'a', deletedAt: '2026-08-01T00:00:00.000Z' }])
  })

  it('without the flag it is a real run', async () => {
    purgeMock.mockResolvedValue(result())
    await route.POST(req())
    expect(purgeMock).toHaveBeenCalledWith({ dryRun: false })
  })
})

describe('purge-trash route: the dry-run flag fails safe', () => {
  it.each(['?dryRun=1', '?dryRun=true', '?dryRun=TRUE'])('%s is a dry run', async (query) => {
    purgeMock.mockResolvedValue(result({ dryRun: true }))
    const res = await route.POST(req({ query }))
    expect(res.status).toBe(200)
    expect(purgeMock).toHaveBeenCalledWith({ dryRun: true })
  })

  it.each(['?dryRun=0', '?dryRun=false'])('%s is an explicit real run', async (query) => {
    purgeMock.mockResolvedValue(result())
    await route.POST(req({ query }))
    expect(purgeMock).toHaveBeenCalledWith({ dryRun: false })
  })

  // A typo must never turn a rehearsal into a deletion.
  it.each(['?dryRun', '?dryRun=', '?dryRun=yes', '?dryRun=on', '?dryRun=2', '?dryrun=1', '?dry_run=1', '?dryRun=1&dryRun=0'])(
    '%s is refused with 400 and purges nothing',
    async (query) => {
      const res = await route.POST(req({ query }))
      expect(res.status).toBe(400)
      expect(purgeMock).not.toHaveBeenCalled()
    },
  )

  it('any unknown query parameter is refused rather than ignored', async () => {
    const res = await route.POST(req({ query: '?force=1' }))
    expect(res.status).toBe(400)
    expect(purgeMock).not.toHaveBeenCalled()
  })
})

describe('purge-trash route: failures are visible to the scheduler', () => {
  it('returns 500 (so the Actions run fails) when any article could not be purged, still reporting what was', async () => {
    purgeMock.mockResolvedValue(
      result({
        count: 1,
        articleIds: ['b'],
        articles: [],
        errors: [{ articleId: 'a', message: 'Invalid `prisma.article.deleteMany()` invocation: FK debates_forArticleId_fkey' }],
      }),
    )
    const res = await route.POST(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].articleId).toBe('a')
    expect(body.errors[0].reference).toMatch(/^[0-9a-f]{8}$/)
    expect(body.purged.articleIds).toEqual(['b'])
    // the raw database error is logged server-side under the same reference, never returned
    expect(JSON.stringify(body)).not.toContain('prisma')
    expect(JSON.stringify(body)).not.toContain('debates_forArticleId_fkey')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('debates_forArticleId_fkey'))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(body.errors[0].reference))
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

describe('the dedicated publishing secret cannot purge', () => {
  const PUBLISH_ONLY = 'publish-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.PUBLISH_CRON_SECRET
    process.env.PUBLISH_CRON_SECRET = PUBLISH_ONLY
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.PUBLISH_CRON_SECRET
    else process.env.PUBLISH_CRON_SECRET = saved
  })

  it.each([
    ['Bearer', { authorization: `Bearer ${PUBLISH_ONLY}` }],
    ['x-cron-secret', { 'x-cron-secret': PUBLISH_ONLY }],
  ])('POST with the publish-only secret as %s is refused (401) and deletes nothing', async (_label, headers) => {
    const res = await route.POST(new Request(URL_BASE, { method: 'POST', headers }))
    expect(res.status).toBe(401)
    expect(purgeMock).not.toHaveBeenCalled()
  })

  it('the route has no other entry point that could be reached with it', () => {
    expect(Object.keys(route).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(['POST'])
  })
})
