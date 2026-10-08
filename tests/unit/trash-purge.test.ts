/**
 * Trash retention purge.
 *
 * Incident 2026-10-07: re-enabling the scheduler made publishScheduledArticles()
 * silently hard-delete two articles that had been in trash for more than 30 days,
 * while the HTTP response said "published: 0". These tests pin the replacement
 * contract: purge is its own explicit job, scoped by the retention cutoff, atomic
 * with an audit row per article, idempotent, and never silent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => {
  const mock = {
    article: { findMany: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  }
  return { prismaMock: mock }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  purgeExpiredTrash,
  resolveRetentionDays,
  TRASH_RETENTION_DAYS,
  TRASH_PURGE_ACTOR,
} from '@/lib/trashPurge'

const NOW = new Date('2026-10-07T00:08:52.000Z')
const CUTOFF = new Date('2026-09-07T00:08:52.000Z')

const row = (id: string, deletedAt: string) => ({
  id,
  title: `Title ${id}`,
  slug: `slug-${id}`,
  authorId: `author-${id}`,
  deletedAt: new Date(deletedAt),
})

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock))
  prismaMock.article.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.auditLog.create.mockResolvedValue({})
})

describe('resolveRetentionDays', () => {
  it('defaults to 30 days', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30)
    expect(resolveRetentionDays(undefined)).toBe(30)
  })
  it('accepts a whole number of days that LENGTHENS retention', () => {
    expect(resolveRetentionDays('45')).toBe(45)
    expect(resolveRetentionDays('30')).toBe(30)
  })
  it.each(['', '0', '-3', '1.5', 'abc', 'NaN'])('never shortens retention on bad input %j', (raw) => {
    expect(resolveRetentionDays(raw)).toBe(30)
  })
  it.each(['1', '7', '29'])('items newer than 30 days can never be purged: %j is clamped up to 30', (raw) => {
    expect(resolveRetentionDays(raw)).toBe(30)
  })
})

describe('purgeExpiredTrash: scope', () => {
  it('selects only trashed rows at or before now - retention', async () => {
    prismaMock.article.findMany.mockResolvedValue([])
    await purgeExpiredTrash({ now: NOW })
    const arg = prismaMock.article.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ deletedAt: { not: null, lte: CUTOFF } })
  })

  it('honours a configured retention period', async () => {
    prismaMock.article.findMany.mockResolvedValue([])
    await purgeExpiredTrash({ now: NOW, retentionDays: 60 })
    const arg = prismaMock.article.findMany.mock.calls[0][0]
    expect(arg.where.deletedAt.lte).toEqual(new Date('2026-08-08T00:08:52.000Z'))
  })

  it('cannot be told to purge anything newer than 30 days, even through the option', async () => {
    prismaMock.article.findMany.mockResolvedValue([])
    const res = await purgeExpiredTrash({ now: NOW, retentionDays: 1 })
    expect(res.retentionDays).toBe(30)
    expect(prismaMock.article.findMany.mock.calls[0][0].where.deletedAt.lte).toEqual(CUTOFF)
  })

  it('re-checks the retention condition at delete time so a restored or newer row survives', async () => {
    prismaMock.article.findMany.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    await purgeExpiredTrash({ now: NOW })
    expect(prismaMock.article.deleteMany).toHaveBeenCalledWith({
      where: { id: 'a', deletedAt: { not: null, lte: CUTOFF } },
    })
  })
})

describe('purgeExpiredTrash: reporting and audit', () => {
  it('reports every purged article with id, title, slug and deletedAt', async () => {
    prismaMock.article.findMany.mockResolvedValue([
      row('a', '2026-08-01T00:00:00Z'),
      row('b', '2026-08-20T00:00:00Z'),
    ])
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.count).toBe(2)
    expect(res.articleIds).toEqual(['a', 'b'])
    expect(res.articles[0]).toEqual({
      id: 'a',
      title: 'Title a',
      slug: 'slug-a',
      deletedAt: '2026-08-01T00:00:00.000Z',
    })
    expect(res.dryRun).toBe(false)
    expect(res.ranAt).toBe(NOW.toISOString())
    expect(res.cutoff).toBe(CUTOFF.toISOString())
    expect(res.retentionDays).toBe(30)
    expect(res.errors).toEqual([])
  })

  it('writes one audit row per purged article, in the same transaction as the delete', async () => {
    prismaMock.article.findMany.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    await purgeExpiredTrash({ now: NOW })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'ARTICLE_HARD_DELETED',
        targetId: 'a',
        targetType: 'article',
        performedBy: TRASH_PURGE_ACTOR,
        metadata: {
          source: 'trash-retention-purge',
          title: 'Title a',
          slug: 'slug-a',
          authorId: 'author-a',
          deletedAt: '2026-08-01T00:00:00.000Z',
          purgedAt: NOW.toISOString(),
          retentionDays: 30,
        },
      },
    })
  })

  it('does not report or audit a row that was restored between select and delete', async () => {
    prismaMock.article.findMany.mockResolvedValue([row('a', '2026-08-01T00:00:00Z'), row('b', '2026-08-02T00:00:00Z')])
    prismaMock.article.deleteMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.articleIds).toEqual(['b'])
    expect(res.count).toBe(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.targetId).toBe('b')
  })
})

describe('purgeExpiredTrash: idempotence', () => {
  it('a second run with nothing left purges nothing and writes nothing', async () => {
    prismaMock.article.findMany.mockResolvedValueOnce([row('a', '2026-08-01T00:00:00Z')]).mockResolvedValueOnce([])
    const first = await purgeExpiredTrash({ now: NOW })
    const second = await purgeExpiredTrash({ now: NOW })
    expect(first.count).toBe(1)
    expect(second.count).toBe(0)
    expect(second.articleIds).toEqual([])
    expect(prismaMock.article.deleteMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)
  })
})

describe('purgeExpiredTrash: dry run', () => {
  it('lists what would be purged without deleting or auditing anything', async () => {
    prismaMock.article.findMany.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    const res = await purgeExpiredTrash({ now: NOW, dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(res.count).toBe(0)
    expect(res.wouldPurge.map((a) => a.id)).toEqual(['a'])
    expect(prismaMock.article.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

describe('purgeExpiredTrash: failures are never silent', () => {
  it('reports a per-article failure, keeps going, and does not claim it was purged', async () => {
    prismaMock.article.findMany.mockResolvedValue([row('a', '2026-08-01T00:00:00Z'), row('b', '2026-08-02T00:00:00Z')])
    prismaMock.$transaction
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockImplementationOnce(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock))
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.articleIds).toEqual(['b'])
    expect(res.errors).toEqual([{ articleId: 'a', message: 'connection reset' }])
  })

  it('rolls the delete back when the audit write fails (audit and delete are atomic)', async () => {
    prismaMock.article.findMany.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    prismaMock.auditLog.create.mockRejectedValue(new Error('audit down'))
    const res = await purgeExpiredTrash({ now: NOW })
    // the transaction callback rejected, so the real database would roll back the delete
    expect(res.count).toBe(0)
    expect(res.errors).toEqual([{ articleId: 'a', message: 'audit down' }])
  })

  it('propagates a failure to even list candidates', async () => {
    prismaMock.article.findMany.mockRejectedValue(new Error('db down'))
    await expect(purgeExpiredTrash({ now: NOW })).rejects.toThrow('db down')
  })
})
