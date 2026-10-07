import { expect, it } from 'vitest'
import { formatEditorialScheduleDisplay } from '@/lib/editorialSchedule'

it('uses deterministic punctuation for hydration and UK wall-clock time', () => {
  expect(formatEditorialScheduleDisplay('2026-11-02T22:23:00Z', { includeYear: false })).toBe('2 Nov, 22:23')
  expect(formatEditorialScheduleDisplay('2026-07-15T11:30:00Z', { includeZone: true })).toBe('15 Jul 2026, 12:30 BST')
  expect(formatEditorialScheduleDisplay('2027-01-15T12:30:00Z', { includeZone: true })).toBe('15 Jan 2027, 12:30 GMT')
  expect(formatEditorialScheduleDisplay(null)).toBe('')
})
