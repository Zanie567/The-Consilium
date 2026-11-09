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

const { prismaMock, imageMock, listMock, retainedMock } = vi.hoisted(() => {
  const mock = {
    article: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  }
  // article.findMany serves two queries: the purgeable list and the debate-retained list (the one with `OR`).
  return { prismaMock: mock, imageMock: { lock: vi.fn(), queue: vi.fn() }, listMock: vi.fn(), retainedMock: vi.fn() }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
// Managed-image reference locking and cleanup queueing (src/lib/articleImageStorage.ts).
vi.mock('@/lib/articleImageStorage', () => ({
  lockArticleImageReferences: imageMock.lock,
  queueDeletedArticleImages: imageMock.queue,
}))

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
  updatedAt: new Date(deletedAt),
  content: `content-${id}`,
  coverImage: `cover-${id}`,
})

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.article.findMany.mockImplementation((args: { where: { OR?: unknown } }) =>
    args.where.OR ? retainedMock(args) : listMock(args))
  retainedMock.mockResolvedValue([])
  prismaMock.article.count.mockResolvedValue(0)
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock))
  prismaMock.article.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.auditLog.create.mockResolvedValue({})
  imageMock.lock.mockResolvedValue([])
  imageMock.queue.mockResolvedValue(undefined)
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
  it('selects only trashed rows at or before now - retention that no debate references', async () => {
    listMock.mockResolvedValue([])
    await purgeExpiredTrash({ now: NOW })
    const arg = listMock.mock.calls[0][0]
    expect(arg.where).toEqual({
      deletedAt: { not: null, lte: CUTOFF },
      forDebates: { none: {} },
      againstDebates: { none: {} },
    })
  })

  it('works through a bounded, oldest-first batch so one run cannot grow without limit', async () => {
    listMock.mockResolvedValue([])
    await purgeExpiredTrash({ now: NOW })
    const arg = listMock.mock.calls[0][0]
    expect(arg.take).toBe(100)
    expect(arg.orderBy).toEqual([{ deletedAt: 'asc' }, { id: 'asc' }])
  })

  it('honours a configured retention period', async () => {
    listMock.mockResolvedValue([])
    await purgeExpiredTrash({ now: NOW, retentionDays: 60 })
    const arg = listMock.mock.calls[0][0]
    expect(arg.where.deletedAt.lte).toEqual(new Date('2026-08-08T00:08:52.000Z'))
  })

  it('cannot be told to purge anything newer than 30 days, even through the option', async () => {
    listMock.mockResolvedValue([])
    const res = await purgeExpiredTrash({ now: NOW, retentionDays: 1 })
    expect(res.retentionDays).toBe(30)
    expect(listMock.mock.calls[0][0].where.deletedAt.lte).toEqual(CUTOFF)
  })

  it('re-checks retention and debate references at delete time so a restored, newer or newly debated row survives', async () => {
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    await purgeExpiredTrash({ now: NOW })
    expect(prismaMock.article.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'a',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        deletedAt: { not: null, lte: CUTOFF },
        forDebates: { none: {} },
        againstDebates: { none: {} },
      },
    })
  })

  it('an edit made after the snapshot wins: the delete is guarded on the row it listed (updatedAt)', async () => {
    const listed = row('a', '2026-08-01T00:00:00Z')
    listMock.mockResolvedValue([listed])
    prismaMock.article.deleteMany.mockResolvedValue({ count: 0 }) // updatedAt moved on, nothing matches
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.count).toBe(0)
    expect(imageMock.queue).not.toHaveBeenCalled()
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })
})

describe('purgeExpiredTrash: reporting and audit', () => {
  it('reports every purged article with id, title, slug and deletedAt', async () => {
    listMock.mockResolvedValue([
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
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
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
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z'), row('b', '2026-08-02T00:00:00Z')])
    prismaMock.article.deleteMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.articleIds).toEqual(['b'])
    expect(res.count).toBe(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.targetId).toBe('b')
  })
})

describe('purgeExpiredTrash: managed image cleanup', () => {
  it('locks the article\'s image references, deletes, queues cleanup, then audits, in that order and in one transaction', async () => {
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    await purgeExpiredTrash({ now: NOW })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(imageMock.lock).toHaveBeenCalledWith(prismaMock, 'content-a', 'cover-a')
    expect(imageMock.queue).toHaveBeenCalledWith(prismaMock, 'content-a', 'cover-a')
    const order = [
      imageMock.lock.mock.invocationCallOrder[0],
      prismaMock.article.deleteMany.mock.invocationCallOrder[0],
      imageMock.queue.mock.invocationCallOrder[0],
      prismaMock.auditLog.create.mock.invocationCallOrder[0],
    ]
    expect(order).toEqual([...order].sort((x, y) => x - y))
  })

  it('does not queue cleanup for a row that was not actually deleted', async () => {
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    prismaMock.article.deleteMany.mockResolvedValue({ count: 0 })
    await purgeExpiredTrash({ now: NOW })
    expect(imageMock.queue).not.toHaveBeenCalled()
  })

  it('rolls the delete back, and reports a failure, when cleanup eligibility cannot be recorded', async () => {
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    imageMock.queue.mockRejectedValue(new Error('Cleanup DB unavailable'))
    const res = await purgeExpiredTrash({ now: NOW })
    // the transaction callback rejected, so the real database rolls the delete back
    expect(res.count).toBe(0)
    expect(res.articleIds).toEqual([])
    expect(res.errors).toEqual([{ articleId: 'a', message: 'Cleanup DB unavailable' }])
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })

  it('a dry run touches no images', async () => {
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    await purgeExpiredTrash({ now: NOW, dryRun: true })
    expect(imageMock.lock).not.toHaveBeenCalled()
    expect(imageMock.queue).not.toHaveBeenCalled()
  })
})

describe('purgeExpiredTrash: idempotence', () => {
  it('a second run with nothing left purges nothing and writes nothing', async () => {
    listMock.mockResolvedValueOnce([row('a', '2026-08-01T00:00:00Z')]).mockResolvedValueOnce([])
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
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
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
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z'), row('b', '2026-08-02T00:00:00Z')])
    prismaMock.$transaction
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockImplementationOnce(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock))
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.articleIds).toEqual(['b'])
    expect(res.errors).toEqual([{ articleId: 'a', message: 'connection reset' }])
  })

  it('rolls the delete back when the audit write fails (audit and delete are atomic)', async () => {
    listMock.mockResolvedValue([row('a', '2026-08-01T00:00:00Z')])
    prismaMock.auditLog.create.mockRejectedValue(new Error('audit down'))
    const res = await purgeExpiredTrash({ now: NOW })
    // the transaction callback rejected, so the real database would roll back the delete
    expect(res.count).toBe(0)
    expect(res.errors).toEqual([{ articleId: 'a', message: 'audit down' }])
  })

  it('propagates a failure to even list candidates', async () => {
    listMock.mockRejectedValue(new Error('db down'))
    await expect(purgeExpiredTrash({ now: NOW })).rejects.toThrow('db down')
  })
})

describe('purgeExpiredTrash: debate-referenced articles are retained, not errors', () => {
  const retainedRow = (id: string, deletedAt: string, forIds: string[], againstIds: string[]) => ({
    id,
    deletedAt: new Date(deletedAt),
    forDebates: forIds.map((d) => ({ id: d })),
    againstDebates: againstIds.map((d) => ({ id: d })),
  })

  it('lists them with the same retention cutoff, oldest first, bounded, and counts them all', async () => {
    listMock.mockResolvedValue([])
    await purgeExpiredTrash({ now: NOW })
    const arg = retainedMock.mock.calls[0][0]
    expect(arg.where).toEqual({
      deletedAt: { not: null, lte: CUTOFF },
      OR: [{ forDebates: { some: {} } }, { againstDebates: { some: {} } }],
    })
    expect(arg.orderBy).toEqual([{ deletedAt: 'asc' }, { id: 'asc' }])
    expect(arg.take).toBe(100)
    expect(prismaMock.article.count).toHaveBeenCalledWith({ where: arg.where })
  })

  it('reports each one once, with its debates sorted and a fixed reason, and never deletes or audits it', async () => {
    listMock.mockResolvedValue([row('plain', '2026-08-03T00:00:00Z')])
    retainedMock.mockResolvedValue([
      retainedRow('for-side', '2026-08-01T00:00:00Z', ['debate-b', 'debate-a'], []),
      retainedRow('both', '2026-08-02T00:00:00Z', ['debate-c'], ['debate-c']),
    ])
    prismaMock.article.count.mockResolvedValue(2)
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.retainedCount).toBe(2)
    expect(res.retained).toEqual([
      {
        id: 'for-side', deletedAt: '2026-08-01T00:00:00.000Z', reason: 'referenced-by-debate',
        debates: [{ debateId: 'debate-a', position: 'for' }, { debateId: 'debate-b', position: 'for' }],
      },
      {
        id: 'both', deletedAt: '2026-08-02T00:00:00.000Z', reason: 'referenced-by-debate',
        debates: [{ debateId: 'debate-c', position: 'against' }, { debateId: 'debate-c', position: 'for' }],
      },
    ])
    expect(res.errors).toEqual([])
    expect(res.articleIds).toEqual(['plain'])
    expect(prismaMock.article.deleteMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1)
  })

  it('an article that shows up in both reads (a debate appeared in between) is retained and not attempted', async () => {
    listMock.mockResolvedValue([row('raced', '2026-08-01T00:00:00Z'), row('plain', '2026-08-02T00:00:00Z')])
    retainedMock.mockResolvedValue([retainedRow('raced', '2026-08-01T00:00:00Z', [], ['debate-x'])])
    prismaMock.article.count.mockResolvedValue(1)
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.retained.map((a) => a.id)).toEqual(['raced'])
    expect(res.articleIds).toEqual(['plain'])
    expect(prismaMock.article.deleteMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.article.deleteMany.mock.calls[0][0].where.id).toBe('plain')

    const dry = await purgeExpiredTrash({ now: NOW, dryRun: true })
    expect(dry.wouldPurge.map((a) => a.id)).toEqual(['plain'])
    expect(dry.retained.map((a) => a.id)).toEqual(['raced'])
  })

  it('a dry run reports retained articles separately from what it would delete', async () => {
    listMock.mockResolvedValue([row('plain', '2026-08-03T00:00:00Z')])
    retainedMock.mockResolvedValue([retainedRow('kept', '2026-08-01T00:00:00Z', ['debate-a'], [])])
    prismaMock.article.count.mockResolvedValue(1)
    const res = await purgeExpiredTrash({ now: NOW, dryRun: true })
    expect(res.wouldPurge.map((a) => a.id)).toEqual(['plain'])
    expect(res.retained.map((a) => a.id)).toEqual(['kept'])
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
