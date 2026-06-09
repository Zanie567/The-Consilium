/**
 * Unit tests for src/lib/editorialCalendar.ts
 */

import { describe, it, expect } from 'vitest'
import {
  isValidMonthParam,
  isRealCalendarDate,
  currentEditorialMonth,
  editorialDateKey,
  editorialTimeLabel,
  monthLabel,
  addMonths,
  buildMonthGrid,
  gridUtcRange,
  moveToEditorialDate,
} from '@/lib/editorialCalendar'

// ── isValidMonthParam ─────────────────────────────────────────────────────────

describe('isValidMonthParam', () => {
  it('accepts well formed months', () => {
    expect(isValidMonthParam('2026-06')).toBe(true)
    expect(isValidMonthParam('2026-01')).toBe(true)
    expect(isValidMonthParam('2026-12')).toBe(true)
  })

  it('rejects malformed or out of range values', () => {
    expect(isValidMonthParam('2026-13')).toBe(false)
    expect(isValidMonthParam('2026-00')).toBe(false)
    expect(isValidMonthParam('2026-6')).toBe(false)
    expect(isValidMonthParam('1999-06')).toBe(false)
    expect(isValidMonthParam('2101-01')).toBe(false)
    expect(isValidMonthParam('garbage')).toBe(false)
    expect(isValidMonthParam('2026-06-01')).toBe(false)
  })
})

// ── isRealCalendarDate ────────────────────────────────────────────────────────

describe('isRealCalendarDate', () => {
  it('accepts real dates including leap days', () => {
    expect(isRealCalendarDate('2026-06-10')).toBe(true)
    expect(isRealCalendarDate('2028-02-29')).toBe(true)
  })

  it('rejects impossible dates that still match the shape regex', () => {
    expect(isRealCalendarDate('2026-13-99')).toBe(false)
    expect(isRealCalendarDate('2026-02-30')).toBe(false)
    expect(isRealCalendarDate('2027-02-29')).toBe(false)
    expect(isRealCalendarDate('2026-00-10')).toBe(false)
    expect(isRealCalendarDate('2026-06-00')).toBe(false)
  })

  it('rejects malformed strings', () => {
    expect(isRealCalendarDate('2026-6-1')).toBe(false)
    expect(isRealCalendarDate('garbage')).toBe(false)
  })
})

// ── buildMonthGrid ────────────────────────────────────────────────────────────

describe('buildMonthGrid', () => {
  it('always produces rows of seven days starting on Monday', () => {
    const weeks = buildMonthGrid('2026-06')
    for (const week of weeks) {
      expect(week).toHaveLength(7)
    }
    // 1 June 2026 is a Monday, so the grid starts on the 1st with no spillover.
    expect(weeks[0][0].key).toBe('2026-06-01')
    expect(weeks[0][0].inMonth).toBe(true)
  })

  it('renders five rows for June 2026 (Monday start, 30 days)', () => {
    expect(buildMonthGrid('2026-06')).toHaveLength(5)
  })

  it('renders six rows for August 2026 (starts Saturday, 31 days)', () => {
    const weeks = buildMonthGrid('2026-08')
    expect(weeks).toHaveLength(6)
    // Spillover before the 1st belongs to July.
    expect(weeks[0][0].key).toBe('2026-07-27')
    expect(weeks[0][0].inMonth).toBe(false)
    expect(weeks[0][5].key).toBe('2026-08-01')
    expect(weeks[0][5].inMonth).toBe(true)
    // The grid ends on a Sunday in September.
    expect(weeks[5][6].key).toBe('2026-09-06')
    expect(weeks[5][6].inMonth).toBe(false)
  })

  it('renders four rows for February 2027 (starts Monday, 28 days)', () => {
    const weeks = buildMonthGrid('2027-02')
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0].key).toBe('2027-02-01')
    expect(weeks[3][6].key).toBe('2027-02-28')
  })

  it('handles leap February', () => {
    const weeks = buildMonthGrid('2028-02')
    const keys = weeks.flat().filter((d) => d.inMonth).map((d) => d.key)
    expect(keys).toHaveLength(29)
    expect(keys[keys.length - 1]).toBe('2028-02-29')
  })

  it('marks weekends', () => {
    const weeks = buildMonthGrid('2026-06')
    for (const week of weeks) {
      expect(week[0].isWeekend).toBe(false) // Monday
      expect(week[4].isWeekend).toBe(false) // Friday
      expect(week[5].isWeekend).toBe(true) // Saturday
      expect(week[6].isWeekend).toBe(true) // Sunday
    }
  })
})

// ── month arithmetic and labels ───────────────────────────────────────────────

describe('addMonths', () => {
  it('moves forward and backward across year boundaries', () => {
    expect(addMonths('2026-06', 1)).toBe('2026-07')
    expect(addMonths('2026-06', -1)).toBe('2026-05')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
})

describe('monthLabel', () => {
  it('formats a human month name', () => {
    expect(monthLabel('2026-06')).toBe('June 2026')
    expect(monthLabel('2026-12')).toBe('December 2026')
  })
})

// ── editorial time zone conversions ───────────────────────────────────────────

describe('editorialDateKey and editorialTimeLabel', () => {
  it('uses the London wall clock, not UTC', () => {
    // 23:30 UTC on 9 June is 00:30 on 10 June in London (BST, UTC+1).
    const instant = new Date('2026-06-09T23:30:00.000Z')
    expect(editorialDateKey(instant)).toBe('2026-06-10')
    expect(editorialTimeLabel(instant)).toBe('00:30')
  })

  it('matches UTC in winter', () => {
    const instant = new Date('2026-01-15T23:30:00.000Z')
    expect(editorialDateKey(instant)).toBe('2026-01-15')
    expect(editorialTimeLabel(instant)).toBe('23:30')
  })
})

describe('currentEditorialMonth', () => {
  it('returns the London month for a given instant', () => {
    // 23:30 UTC on 30 June is already July in London.
    expect(currentEditorialMonth(new Date('2026-06-30T23:30:00.000Z'))).toBe('2026-07')
    expect(currentEditorialMonth(new Date('2026-06-15T12:00:00.000Z'))).toBe('2026-06')
  })
})

// ── gridUtcRange ──────────────────────────────────────────────────────────────

describe('gridUtcRange', () => {
  it('covers the whole visible grid in London time', () => {
    const weeks = buildMonthGrid('2026-08')
    const { start, end } = gridUtcRange(weeks)
    // Grid runs 27 July to 6 September 2026, both BST (UTC+1).
    expect(start.toISOString()).toBe('2026-07-26T23:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-06T23:00:00.000Z')
  })

  it('spans a DST boundary without gaps (October 2026)', () => {
    // Clocks go back 25 October 2026 in London.
    const weeks = buildMonthGrid('2026-10')
    const { start, end } = gridUtcRange(weeks)
    expect(start.toISOString()).toBe('2026-09-27T23:00:00.000Z') // BST midnight
    expect(end.toISOString()).toBe('2026-11-02T00:00:00.000Z') // GMT midnight
  })
})

// ── moveToEditorialDate ───────────────────────────────────────────────────────

describe('moveToEditorialDate', () => {
  it('changes the date and keeps the London wall clock time', () => {
    const current = new Date('2026-06-10T13:30:00.000Z') // 14:30 London (BST)
    const moved = moveToEditorialDate(current, '2026-06-20')
    expect(moved?.toISOString()).toBe('2026-06-20T13:30:00.000Z')
    expect(moved && editorialTimeLabel(moved)).toBe('14:30')
  })

  it('keeps wall clock time across a DST boundary', () => {
    // 14:30 London in June is 13:30 UTC; in December it must become 14:30 UTC.
    const current = new Date('2026-06-10T13:30:00.000Z')
    const moved = moveToEditorialDate(current, '2026-12-10')
    expect(moved?.toISOString()).toBe('2026-12-10T14:30:00.000Z')
    expect(moved && editorialTimeLabel(moved)).toBe('14:30')
  })

  it('returns null for a time skipped by the spring DST jump', () => {
    // Clocks jump 01:00 to 02:00 on 29 March 2026, so 01:30 does not exist.
    const current = new Date('2026-01-10T01:30:00.000Z') // 01:30 London (GMT)
    expect(moveToEditorialDate(current, '2026-03-29')).toBeNull()
  })

  it('rejects malformed target dates', () => {
    const current = new Date('2026-06-10T13:30:00.000Z')
    expect(moveToEditorialDate(current, '2026-6-2')).toBeNull()
    expect(moveToEditorialDate(current, 'not-a-date')).toBeNull()
  })
})
