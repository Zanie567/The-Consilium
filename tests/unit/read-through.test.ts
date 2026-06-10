/**
 * Pure shaping logic for the writer read-through feature, no database needed.
 * The SQL aggregation itself is verified against a real Postgres in
 * tests/integration/read-through-db.test.ts using the same hand-computed
 * fixture; here we cover the shaping, gating, and steepest-drop maths.
 */
import { describe, it, expect } from 'vitest'
import {
  MIN_READ_THROUGH_SAMPLE,
  RETENTION_THRESHOLDS,
  buildRetention,
  findSteepestDrop,
  shapeListStats,
  shapeReadThrough,
} from '@/lib/read-through'

// Reference aggregation used to build inputs from raw progress values, so each
// case below is stated in terms of readers, not pre-chewed counts.
function aggRow(progresses: number[]) {
  return {
    readerCount: progresses.length,
    completedCount: progresses.filter((p) => p >= 90).length,
    medianProgress: median(progresses),
    pastCounts: RETENTION_THRESHOLDS.map((t) => progresses.filter((p) => p >= t).length),
  }
}
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = (s.length - 1) / 2
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2
}

// The same 24-reader distribution the DB test and the live seed script use,
// with a deliberate cliff in the 30s.
const FIXTURE = [
  5, 8, 22, 26, 31, 33, 35, 36, 38, 39, 52, 55, 61, 64, 68, 72, 75, 81, 85, 90,
  93, 96, 100, 100,
]

describe('shapeReadThrough', () => {
  it('empty data returns the not-enough-data state with zero readers', () => {
    const out = shapeReadThrough(aggRow([]))
    expect(out).toEqual({
      readerCount: 0,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
      retention: null,
      steepestDrop: null,
    })
  })

  it('exactly one reader is below the minimum sample and exposes no metrics', () => {
    const out = shapeReadThrough(aggRow([73]))
    expect(out.readerCount).toBe(1)
    expect(out.hasEnoughData).toBe(false)
    expect(out.completionRate).toBeNull()
    expect(out.medianProgress).toBeNull()
    expect(out.retention).toBeNull()
    expect(out.steepestDrop).toBeNull()
  })

  it('anything under the 5-reader minimum returns the not-enough-data state', () => {
    const out = shapeReadThrough(aggRow([10, 50, 80, 95]))
    expect(out.readerCount).toBe(4)
    expect(out.readerCount).toBeLessThan(MIN_READ_THROUGH_SAMPLE)
    expect(out.hasEnoughData).toBe(false)
    expect(out.retention).toBeNull()
  })

  it('all readers at 100%: full retention, 100% completion, no drop to report', () => {
    const out = shapeReadThrough(aggRow([100, 100, 100, 100, 100, 100]))
    expect(out.readerCount).toBe(6)
    expect(out.hasEnoughData).toBe(true)
    expect(out.completionRate).toBe(100)
    expect(out.medianProgress).toBe(100)
    expect(out.retention).toEqual(
      RETENTION_THRESHOLDS.map((threshold) => ({ threshold, readers: 6, share: 100 }))
    )
    expect(out.steepestDrop).toBeNull()
  })

  it('all readers at 0%: zero retention everywhere, everyone lost before 10%', () => {
    const out = shapeReadThrough(aggRow([0, 0, 0, 0, 0]))
    expect(out.readerCount).toBe(5)
    expect(out.hasEnoughData).toBe(true)
    expect(out.completionRate).toBe(0)
    expect(out.medianProgress).toBe(0)
    expect(out.retention).toEqual(
      RETENTION_THRESHOLDS.map((threshold) => ({ threshold, readers: 0, share: 0 }))
    )
    expect(out.steepestDrop).toEqual({ from: 0, to: 10, readersLost: 5, lostShare: 100 })
  })

  it('known 24-reader fixture: hand-computed deciles, median, completion, drop', () => {
    const out = shapeReadThrough(aggRow(FIXTURE))
    expect(out.readerCount).toBe(24)
    expect(out.hasEnoughData).toBe(true)
    // 5 of 24 readers reached 90% or further: 20.83% rounds to 21.
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
    // Six readers stopped in the 30s, the largest single-segment loss.
    expect(out.steepestDrop).toEqual({ from: 30, to: 40, readersLost: 6, lostShare: 25 })
  })

  it('rounds a fractional median instead of truncating it', () => {
    const out = shapeReadThrough({
      readerCount: 6,
      completedCount: 0,
      medianProgress: 57.5,
      pastCounts: [6, 6, 6, 6, 4, 2, 0, 0, 0, 0],
    })
    expect(out.medianProgress).toBe(58)
  })
})

describe('findSteepestDrop', () => {
  it('keeps the earliest segment when two segments lose the same number', () => {
    // 10 readers: lose 3 between 20 and 30, and 3 again between 60 and 70.
    const pastCounts = [10, 10, 7, 7, 7, 7, 4, 4, 4, 4]
    expect(findSteepestDrop(pastCounts, 10)).toEqual({
      from: 20,
      to: 30,
      readersLost: 3,
      lostShare: 30,
    })
  })

  it('returns null when nobody is ever lost', () => {
    const pastCounts = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
    expect(findSteepestDrop(pastCounts, 8)).toBeNull()
  })

  it('returns null for zero readers', () => {
    expect(findSteepestDrop(RETENTION_THRESHOLDS.map(() => 0), 0)).toBeNull()
  })
})

describe('buildRetention', () => {
  it('rounds shares to whole percents of the reader count', () => {
    const retention = buildRetention([3, 3, 3, 2, 2, 1, 1, 1, 0, 0], 3)
    expect(retention[0]).toEqual({ threshold: 10, readers: 3, share: 100 })
    expect(retention[3]).toEqual({ threshold: 40, readers: 2, share: 67 })
    expect(retention[5]).toEqual({ threshold: 60, readers: 1, share: 33 })
    expect(retention[9]).toEqual({ threshold: 100, readers: 0, share: 0 })
  })
})

describe('shapeListStats', () => {
  it('nulls metrics below the minimum sample but keeps the reader count', () => {
    const out = shapeListStats({ readerCount: 3, completedCount: 2, medianProgress: 80 })
    expect(out).toEqual({
      readerCount: 3,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
    })
  })

  it('computes rates at or above the minimum sample', () => {
    const out = shapeListStats({ readerCount: 5, completedCount: 2, medianProgress: 61.5 })
    expect(out).toEqual({
      readerCount: 5,
      hasEnoughData: true,
      completionRate: 40,
      medianProgress: 62,
    })
  })
})
