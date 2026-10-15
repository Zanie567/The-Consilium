/**
 * The calendar E2E test's dates (tests/e2e/helpers/calendarDates.ts) must hold on every day it can run, issue #135.
 * Each instant below is a boundary for the editorial time zone (Europe/London) or for the month grid.
 */
import { describe, it, expect } from 'vitest'
import { buildMonthGrid, editorialDateKey } from '@/lib/editorialCalendar'
import { dayCellName, futureReschedule, pastDrop } from '../e2e/helpers/calendarDates'

const NOWS: Record<string, string> = {
  'an ordinary weekday': '2026-10-14T10:00:00Z',
  'the minute before London midnight': '2026-10-14T22:59:30Z', // 23:59:30 BST
  'just after London midnight, still the previous day in UTC': '2026-06-30T23:30:00Z', // 1 July 00:30 BST
  'the first cell of the grid (Monday the 1st)': '2027-02-01T09:00:00Z',
  'the first minute of Monday the 1st': '2027-02-01T00:00:30Z',
  'the last cell of the grid (Sunday the 31st)': '2027-01-31T12:00:00Z',
  'the last minute of a Sunday that ends the month': '2027-01-31T23:59:30Z',
  'the clocks going forward': '2027-03-28T01:30:00Z',
  'the clocks going back': '2026-10-25T01:30:00Z',
  'the last minute of the year': '2026-12-31T23:59:30Z',
  'a leap day': '2028-02-29T12:00:00Z',
}

const gridKeys = (month: string) => buildMonthGrid(month).flat().map((d) => d.key)

describe.each(Object.entries(NOWS))('calendar E2E dates on %s', (_, iso) => {
  const now = new Date(iso)

  it('the successful drag moves a future 12:30 article one day later, two months ahead', () => {
    const plan = futureReschedule(now)
    expect(plan.from.getTime()).toBeGreaterThan(now.getTime())
    expect(gridKeys(plan.month)).toEqual(expect.arrayContaining([plan.fromKey, plan.toKey]))
    expect(editorialDateKey(plan.from)).toBe(plan.fromKey)
    expect(editorialDateKey(plan.to)).toBe(plan.toKey)
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(plan.to)).toBe('12:30')
  })

  it('the refused drag uses two days on the current grid, and its target is always in the past', () => {
    const plan = pastDrop(now)
    const keys = gridKeys(plan.month)
    expect(keys).toEqual(expect.arrayContaining([plan.sourceKey, plan.targetKey]))
    expect(plan.month).toBe(editorialDateKey(now).slice(0, 7))
    expect(plan.target.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(plan.sourceKey).not.toBe(plan.targetKey)
    expect(editorialDateKey(plan.source)).toBe(plan.sourceKey)
    // The source is tomorrow (not yet due) unless today is the grid's last cell.
    const today = editorialDateKey(now)
    if (keys[keys.length - 1] === today) expect(plan.sourceKey).toBe(today)
    else expect(plan.source.getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('dayCellName', () => {
  it('matches the calendar cell label, not a neighbouring day', () => {
    expect('Saturday, 16 January 2027, 1 item').toMatch(dayCellName('2027-01-16'))
    expect('Saturday, 16 January 2027, nothing planned').toMatch(dayCellName('2027-01-16'))
    expect('Saturday, 6 January 2027, 1 item').not.toMatch(dayCellName('2027-01-16'))
  })
})
