/**
 * Read-through aggregation tests against the real (seeded) Postgres DB.
 *
 * The aggregation runs in SQL (FILTER counts + percentile_cont), so it can
 * only be meaningfully tested against Postgres. Every expectation here is
 * hand-computed from the fixture progress values, which are the same values
 * tests/unit/read-through.test.ts and prisma/seed-read-through.ts use.
 *
 * Every run creates private draft fixtures. Public browsing changes reading
 * progress, so reusing the published demo articles polluted later reruns.
 * An unavailable test database fails setup; it cannot produce false passes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { assertRunDatabase } from '../../scripts/lib/assertRunDatabase'
assertRunDatabase()

// The Vitest guard has already pinned DATABASE_URL to TEST_DATABASE_URL.
const { prisma } = await import('@/lib/prisma')
const { getArticleReadThrough, getReadStatsByArticleIds } = await import('@/lib/read-through')

// Slugs created by prisma/seed-read-through.ts.
const SLUGS = {
  fixture: 'the-long-read-experiment', // 24 readers, cliff in the 30s
  three: 'the-small-sample',           // 3 readers, below the minimum sample
  empty: 'rt-edge-empty',              // no readers at all
  single: 'rt-edge-single',            // one reader at 42%
  all100: 'rt-edge-all100',            // 6 readers, all at 100%
  all0: 'rt-edge-all0',                // 5 readers, all at 0%
} as const

const fixtureTag = `rt-integration-${randomUUID()}`
const progresses = {
  fixture: [5, 8, 22, 26, 31, 33, 35, 36, 38, 39, 52, 55, 61, 64, 68, 72, 75, 81, 85, 90, 93, 96, 100, 100],
  three: [10, 50, 80], empty: [], single: [42], all100: [100, 100, 100, 100, 100, 100], all0: [0, 0, 0, 0, 0],
}
const ids: Record<keyof typeof SLUGS, string> = {
  fixture: '', three: '', empty: '', single: '', all100: '', all0: '',
}

beforeAll(async () => {
  assertRunDatabase()
  const author = await prisma.user.create({ data: { email: `${fixtureTag}@consilium.test`, role: 'WRITER' } })
  const readers = await Promise.all(Array.from({ length: 24 }, (_, i) => prisma.user.create({
    data: { email: `${fixtureTag}-${i}@consilium.test`, role: 'READER' },
  })))
  for (const key of Object.keys(SLUGS) as (keyof typeof SLUGS)[]) {
    const article = await prisma.article.create({ data: {
      title: `${fixtureTag}-${key}`, slug: `${fixtureTag}-${key}`, authorId: author.id,
      status: 'DRAFT', content: '{"type":"doc","content":[]}',
    } })
    ids[key] = article.id
    if (progresses[key].length) await prisma.readingProgress.createMany({ data: progresses[key].map((progress, i) => ({
      articleId: article.id, userId: readers[i].id, progress, completed: progress >= 90, scrollY: 0,
    })) })
  }
})

afterAll(async () => {
  await prisma.article.deleteMany({ where: { slug: { startsWith: fixtureTag } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: fixtureTag } } })
  await prisma.$disconnect().catch(() => {})
})

describe('getArticleReadThrough (SQL aggregation)', () => {
  it('returns the empty not-enough-data state for an article with no readers', async () => {
    const out = await getArticleReadThrough(ids.empty)
    expect(out).toEqual({
      readerCount: 0,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
      retention: null,
      steepestDrop: null,
    })
  })

  it('one reader stays below the minimum sample', async () => {
    const out = await getArticleReadThrough(ids.single)
    expect(out.readerCount).toBe(1)
    expect(out.hasEnoughData).toBe(false)
    expect(out.retention).toBeNull()
    expect(out.medianProgress).toBeNull()
  })

  it('all readers at 100%: complete retention and no drop', async () => {
    const out = await getArticleReadThrough(ids.all100)
    expect(out.readerCount).toBe(6)
    expect(out.completionRate).toBe(100)
    expect(out.medianProgress).toBe(100)
    expect(out.retention?.every((r) => r.readers === 6 && r.share === 100)).toBe(true)
    expect(out.steepestDrop).toBeNull()
  })

  it('all readers at 0%: zero retention, everyone lost before the 10% mark', async () => {
    const out = await getArticleReadThrough(ids.all0)
    expect(out.readerCount).toBe(5)
    expect(out.completionRate).toBe(0)
    expect(out.medianProgress).toBe(0)
    expect(out.retention?.every((r) => r.readers === 0 && r.share === 0)).toBe(true)
    expect(out.steepestDrop).toEqual({ from: 0, to: 10, readersLost: 5, lostShare: 100 })
  })

  it('24-reader fixture matches the hand-computed deciles, median, and drop', async () => {
    const out = await getArticleReadThrough(ids.fixture)
    expect(out.readerCount).toBe(24)
    expect(out.hasEnoughData).toBe(true)
    // 5 of 24 readers reached at least 90%: 20.83% rounds to 21.
    expect(out.completionRate).toBe(21)
    // Sorted middle pair is 55 and 61, so the continuous median is 58.
    expect(out.medianProgress).toBe(58)
    expect(out.retention).toEqual([
      { threshold: 10, readers: 22, share: 92 },
      { threshold: 20, readers: 22, share: 92 },
      { threshold: 30, readers: 20, share: 83 },
      { threshold: 40, readers: 14, share: 58 },
      { threshold: 50, readers: 14, share: 58 },
      { threshold: 60, readers: 12, share: 50 },
      { threshold: 70, readers: 9, share: 38 },
      { threshold: 80, readers: 7, share: 29 },
      { threshold: 90, readers: 5, share: 21 },
      { threshold: 100, readers: 2, share: 8 },
    ])
    // Six readers stopped in the 30s, the largest single-segment loss (25%).
    expect(out.steepestDrop).toEqual({ from: 30, to: 40, readersLost: 6, lostShare: 25 })
  })

  it('three readers (below threshold) return the not-enough-data state', async () => {
    const out = await getArticleReadThrough(ids.three)
    expect(out.readerCount).toBe(3)
    expect(out.hasEnoughData).toBe(false)
    expect(out.completionRate).toBeNull()
    expect(out.medianProgress).toBeNull()
    expect(out.retention).toBeNull()
    expect(out.steepestDrop).toBeNull()
  })
})

describe('getReadStatsByArticleIds (grouped SQL for the list view)', () => {
  it('aggregates each article in one grouped query and omits articles with no rows', async () => {
    const map = await getReadStatsByArticleIds(Object.values(ids))

    expect(map.get(ids.fixture)).toEqual({
      readerCount: 24,
      hasEnoughData: true,
      completionRate: 21,
      medianProgress: 58,
    })
    expect(map.get(ids.three)).toEqual({
      readerCount: 3,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
    })
    // No rows at all: not present, callers fall back to EMPTY_LIST_STATS.
    expect(map.has(ids.empty)).toBe(false)
  })

  it('returns an empty map for an empty id list without querying', async () => {
    const map = await getReadStatsByArticleIds([])
    expect(map.size).toBe(0)
  })
})
