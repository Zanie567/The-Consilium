/**
 * Unit tests for src/lib/predictions.ts: scoring rules, semester keys, and
 * deadline enforcement.
 */

import { describe, it, expect } from 'vitest'
import {
  MAX_POINTS,
  semesterKeyForDate,
  semesterLabel,
  isValidSemesterKey,
  scorePrediction,
  computeScores,
  validateSubmission,
  isClosedForSubmissions,
  type SubmissionEvent,
} from '@/lib/predictions'

// ── semesterKeyForDate ────────────────────────────────────────────────────────

describe('semesterKeyForDate', () => {
  it('puts January through June in S1', () => {
    expect(semesterKeyForDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-S1')
    expect(semesterKeyForDate(new Date('2026-06-30T23:59:59Z'))).toBe('2026-S1')
  })

  it('puts July through December in S2', () => {
    expect(semesterKeyForDate(new Date('2026-07-01T00:00:00Z'))).toBe('2026-S2')
    expect(semesterKeyForDate(new Date('2026-12-31T23:59:59Z'))).toBe('2026-S2')
  })

  it('uses UTC, not local time', () => {
    // 30 June 23:00 UTC is still S1 regardless of the machine's timezone.
    expect(semesterKeyForDate(new Date('2026-06-30T23:00:00Z'))).toBe('2026-S1')
  })
})

describe('semesterLabel and isValidSemesterKey', () => {
  it('labels keys readably and passes unknown strings through', () => {
    expect(semesterLabel('2026-S1')).toBe('2026, January to June')
    expect(semesterLabel('2026-S2')).toBe('2026, July to December')
    expect(semesterLabel('garbage')).toBe('garbage')
  })

  it('validates key shape', () => {
    expect(isValidSemesterKey('2026-S1')).toBe(true)
    expect(isValidSemesterKey('2026-S2')).toBe(true)
    expect(isValidSemesterKey('2026-S3')).toBe(false)
    expect(isValidSemesterKey('26-S1')).toBe(false)
    expect(isValidSemesterKey('all')).toBe(false)
  })
})

// ── scorePrediction ───────────────────────────────────────────────────────────

describe('scorePrediction', () => {
  it('awards full points for an exact prediction', () => {
    expect(scorePrediction(4.25, 4.25, 0.5)).toEqual({ points: MAX_POINTS, absError: 0 })
  })

  it('scales points down linearly to zero at maxError', () => {
    expect(scorePrediction(4.0, 4.5, 1.0).points).toBe(50)
    expect(scorePrediction(4.25, 4.5, 0.5).points).toBe(50)
    expect(scorePrediction(4.4, 4.5, 0.5).points).toBeCloseTo(80, 5)
  })

  it('awards zero at or beyond maxError', () => {
    expect(scorePrediction(3.5, 4.5, 1.0).points).toBe(0)
    expect(scorePrediction(2.0, 4.5, 1.0).points).toBe(0)
  })

  it('is symmetric above and below the actual value', () => {
    expect(scorePrediction(4.0, 4.5, 1.0).points).toBe(scorePrediction(5.0, 4.5, 1.0).points)
  })

  it('reports the absolute error', () => {
    expect(scorePrediction(3.1, 4.5, 1.0).absError).toBeCloseTo(1.4, 6)
  })

  it('handles a degenerate non-positive maxError as exact-only', () => {
    expect(scorePrediction(4.5, 4.5, 0).points).toBe(MAX_POINTS)
    expect(scorePrediction(4.4, 4.5, 0).points).toBe(0)
  })
})

// ── computeScores ─────────────────────────────────────────────────────────────

const DEADLINE = new Date('2026-08-01T11:00:00Z')
const BEFORE = new Date('2026-08-01T10:00:00Z')
const AFTER = new Date('2026-08-01T11:00:01Z')

describe('computeScores', () => {
  it('ranks on-time predictions by absolute error', () => {
    const scores = computeScores(
      [
        { id: 'far', value: 5.5, updatedAt: BEFORE },
        { id: 'exact', value: 4.5, updatedAt: BEFORE },
        { id: 'near', value: 4.6, updatedAt: BEFORE },
      ],
      4.5,
      1.0,
      DEADLINE
    )
    const byId = new Map(scores.map((s) => [s.id, s]))
    expect(byId.get('exact')?.rank).toBe(1)
    expect(byId.get('near')?.rank).toBe(2)
    expect(byId.get('far')?.rank).toBe(3)
  })

  it('lets ties share a rank and skips the next rank', () => {
    const scores = computeScores(
      [
        { id: 'low', value: 4.4, updatedAt: BEFORE },
        { id: 'high', value: 4.6, updatedAt: BEFORE },
        { id: 'worst', value: 5.0, updatedAt: BEFORE },
      ],
      4.5,
      1.0,
      DEADLINE
    )
    const byId = new Map(scores.map((s) => [s.id, s]))
    expect(byId.get('low')?.rank).toBe(1)
    expect(byId.get('high')?.rank).toBe(1)
    expect(byId.get('low')?.points).toBe(byId.get('high')?.points)
    expect(byId.get('worst')?.rank).toBe(3)
  })

  it('never awards points or a rank to predictions written after the deadline', () => {
    const scores = computeScores(
      [
        { id: 'late-exact', value: 4.5, updatedAt: AFTER },
        { id: 'ontime', value: 5.0, updatedAt: BEFORE },
      ],
      4.5,
      1.0,
      DEADLINE
    )
    const byId = new Map(scores.map((s) => [s.id, s]))
    // Even an exact answer scores nothing when it arrived late.
    expect(byId.get('late-exact')?.points).toBe(0)
    expect(byId.get('late-exact')?.rank).toBeNull()
    expect(byId.get('late-exact')?.late).toBe(true)
    expect(byId.get('ontime')?.rank).toBe(1)
  })

  it('treats a write exactly at the deadline as on time', () => {
    const scores = computeScores(
      [{ id: 'at', value: 4.5, updatedAt: DEADLINE }],
      4.5,
      1.0,
      DEADLINE
    )
    expect(scores[0].points).toBe(MAX_POINTS)
    expect(scores[0].rank).toBe(1)
  })

  it('returns an empty list for no predictions', () => {
    expect(computeScores([], 4.5, 1.0, DEADLINE)).toEqual([])
  })
})

// ── validateSubmission ────────────────────────────────────────────────────────

const OPEN_EVENT: SubmissionEvent = {
  status: 'OPEN',
  deadline: DEADLINE,
  minValue: 0,
  maxValue: 10,
  unitLabel: '%',
}

describe('validateSubmission', () => {
  it('accepts a numeric value inside bounds before the deadline', () => {
    expect(validateSubmission(4.5, OPEN_EVENT, BEFORE)).toEqual({ ok: true, value: 4.5 })
    expect(validateSubmission('4.5', OPEN_EVENT, BEFORE)).toEqual({ ok: true, value: 4.5 })
    expect(validateSubmission(0, OPEN_EVENT, BEFORE)).toEqual({ ok: true, value: 0 })
    expect(validateSubmission(10, OPEN_EVENT, BEFORE)).toEqual({ ok: true, value: 10 })
  })

  it('rejects non-numeric values', () => {
    expect(validateSubmission('abc', OPEN_EVENT, BEFORE).ok).toBe(false)
    expect(validateSubmission('', OPEN_EVENT, BEFORE).ok).toBe(false)
    expect(validateSubmission(null, OPEN_EVENT, BEFORE).ok).toBe(false)
    expect(validateSubmission(undefined, OPEN_EVENT, BEFORE).ok).toBe(false)
    expect(validateSubmission(NaN, OPEN_EVENT, BEFORE).ok).toBe(false)
    expect(validateSubmission(Infinity, OPEN_EVENT, BEFORE).ok).toBe(false)
    expect(validateSubmission({ value: 4 }, OPEN_EVENT, BEFORE).ok).toBe(false)
  })

  it('rejects values outside the per-event bounds', () => {
    expect(validateSubmission(-0.1, OPEN_EVENT, BEFORE).ok).toBe(false)
    expect(validateSubmission(10.1, OPEN_EVENT, BEFORE).ok).toBe(false)
  })

  it('rejects submissions at or after the deadline', () => {
    expect(validateSubmission(4.5, OPEN_EVENT, DEADLINE).ok).toBe(false)
    expect(validateSubmission(4.5, OPEN_EVENT, AFTER).ok).toBe(false)
  })

  it('rejects submissions when the event is not open', () => {
    for (const status of ['CLOSED', 'RESOLVED', 'CANCELLED'] as const) {
      expect(validateSubmission(4.5, { ...OPEN_EVENT, status }, BEFORE).ok).toBe(false)
    }
  })
})

// ── isClosedForSubmissions ────────────────────────────────────────────────────

describe('isClosedForSubmissions', () => {
  it('stays open while OPEN and before the deadline', () => {
    expect(isClosedForSubmissions({ status: 'OPEN', deadline: DEADLINE }, BEFORE)).toBe(false)
  })

  it('closes at the deadline and for any non-open status', () => {
    expect(isClosedForSubmissions({ status: 'OPEN', deadline: DEADLINE }, DEADLINE)).toBe(true)
    expect(isClosedForSubmissions({ status: 'CLOSED', deadline: DEADLINE }, BEFORE)).toBe(true)
    expect(isClosedForSubmissions({ status: 'CANCELLED', deadline: DEADLINE }, BEFORE)).toBe(true)
  })
})
