/**
 * Read-through aggregation tests against the real (seeded) Postgres DB.
 *
 * The aggregation runs in SQL (FILTER counts + percentile_cont), so it can
 * only be meaningfully tested against Postgres. Every expectation here is
 * hand-computed from the fixture progress values, which are the same values
 * tests/unit/read-through.test.ts and prisma/seed-read-through.ts use.
 *
 * This suite is strictly read-only: the fixtures are created once by
 * prisma/seed-read-through.ts (run by scripts/setup-test-db.sh), so nothing
 * here can race the other DB-backed suites running in parallel workers.
 *
 * Requires DATABASE_URL (loaded from .env.local). If the DB is unreachable or
 * the fixtures are missing, the suite is skipped with a warning, mirroring
 * data-layer.test.ts.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../../.env.local') })

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Imported dynamically so @/lib/prisma initialises after .env.local is loaded.
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

let ready = false
const ids: Record<keyof typeof SLUGS, string> = {
  fixture: '', three: '', empty: '', single: '', all100: '', all0: '',
}

beforeAll(async () => {
  try {
    const slugs = Object.values(SLUGS)
    const articles = await prisma.article.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true },
    })
    if (articles.length === slugs.length) {
      for (const [key, slug] of Object.entries(SLUGS)) {
        ids[key as keyof typeof SLUGS] = articles.find((a) => a.slug === slug)!.id
      }
      ready = true
    } else {
      console.warn(
        '[read-through-db] fixtures missing — skipping. Run scripts/setup-test-db.sh (it runs prisma/seed-read-through.ts).'
      )
    }
  } catch {
    console.warn('[read-through-db] DB unreachable — skipping. Run scripts/setup-test-db.sh first.')
  }
})

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

describe('getArticleReadThrough (SQL aggregation)', () => {
  it('returns the empty not-enough-data state for an article with no readers', async () => {
    if (!ready) return
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
    if (!ready) return
    const out = await getArticleReadThrough(ids.single)
    expect(out.readerCount).toBe(1)
    expect(out.hasEnoughData).toBe(false)
    expect(out.retention).toBeNull()
    expect(out.medianProgress).toBeNull()
  })

  it('all readers at 100%: complete retention and no drop', async () => {
    if (!ready) return
    const out = await getArticleReadThrough(ids.all100)
    expect(out.readerCount).toBe(6)
    expect(out.completionRate).toBe(100)
    expect(out.medianProgress).toBe(100)
    expect(out.retention?.every((r) => r.readers === 6 && r.share === 100)).toBe(true)
    expect(out.steepestDrop).toBeNull()
  })

  it('all readers at 0%: zero retention, everyone lost before the 10% mark', async () => {
    if (!ready) return
    const out = await getArticleReadThrough(ids.all0)
    expect(out.readerCount).toBe(5)
    expect(out.completionRate).toBe(0)
    expect(out.medianProgress).toBe(0)
    expect(out.retention?.every((r) => r.readers === 0 && r.share === 0)).toBe(true)
    expect(out.steepestDrop).toEqual({ from: 0, to: 10, readersLost: 5, lostShare: 100 })
  })

  it('24-reader fixture matches the hand-computed deciles, median, and drop', async () => {
    if (!ready) return
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
    if (!ready) return
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
    if (!ready) return
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
