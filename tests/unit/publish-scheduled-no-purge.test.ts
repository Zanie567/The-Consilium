/**
 * Scheduled publishing and trash purge are independent jobs.
 *
 * Incident 2026-10-07: POST /api/publish-scheduled returned {"due":0,"published":0}
 * while publishScheduledArticles() hard-deleted two trashed articles as a hidden side
 * effect. Publishing must now be incapable of deleting anything, and its response must
 * never carry (or hide) destructive work.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { prismaMock, revalidateMock } = vi.hoisted(() => ({
  prismaMock: {
    article: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
  revalidateMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: revalidateMock }))
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(() => Promise.resolve()),
  articlePublishedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
}))
vi.mock('@/lib/gamification/achievements', () => ({ awardPublishAchievements: vi.fn() }))

import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import { POST } from '@/app/api/publish-scheduled/route'

const SECRET = 'test-secret-value-that-is-long-enough-0123456789'
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

const authed = () =>
  new Request('https://www.theconsilium.co.uk/api/publish-scheduled', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
  })

describe('publishScheduledArticles', () => {
  it('never deletes anything, whether or not articles are due', async () => {
    prismaMock.article.findMany.mockResolvedValue([])
    await publishScheduledArticles(new Date('2026-10-07T00:08:52Z'))
    expect(prismaMock.article.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.article.delete).not.toHaveBeenCalled()
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it('does not carry a purge field in its result', async () => {
    prismaMock.article.findMany.mockResolvedValue([])
    const result = await publishScheduledArticles(new Date('2026-10-07T00:08:52Z'))
    expect(result).not.toHaveProperty('purged')
  })

  it('still publishes a due article on its own (compare-and-set, notification, cache refresh)', async () => {
    const due = {
      id: 'art1',
      title: 'Due article',
      slug: 'due-article',
      authorId: 'u1',
      seriesId: null,
      author: { id: 'u1', email: 'w@example.com', name: 'Writer' },
    }
    prismaMock.article.findMany.mockResolvedValue([due])
    prismaMock.article.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.notification.create.mockResolvedValue({})
    const now = new Date('2026-10-07T00:08:52Z')
    const result = await publishScheduledArticles(now)
    expect(result.published).toEqual([{ id: 'art1', title: 'Due article', slug: 'due-article' }])
    expect(prismaMock.article.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PUBLISHED', publishedAt: now, scheduledAt: null } }),
    )
    expect(prismaMock.article.deleteMany).not.toHaveBeenCalled()
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('a second invocation does not double-publish an article another run already published', async () => {
    const due = { id: 'art1', title: 'T', slug: 's', authorId: 'u1', seriesId: null, author: { id: 'u1', email: 'a@b.c', name: 'W' } }
    prismaMock.article.findMany.mockResolvedValue([due])
    prismaMock.article.updateMany.mockResolvedValue({ count: 0 }) // lost the compare-and-set
    const result = await publishScheduledArticles(new Date('2026-10-07T00:08:52Z'))
    expect(result.published).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/publish-scheduled', () => {
  it('an empty run deletes nothing and says so by construction: no purge key in any response', async () => {
    prismaMock.article.findMany.mockResolvedValue([])
    const res = await POST(authed())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ due: 0, published: 0, articles: [], skipped: [], warnings: [] })
    expect(body).not.toHaveProperty('purged')
    expect(prismaMock.article.deleteMany).not.toHaveBeenCalled()
  })
})
