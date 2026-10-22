import { expect, it } from 'vitest'
import { parseEditorialScheduleInput, formatEditorialScheduleDisplay } from '@/lib/editorialSchedule'

it('launch Friday uses BST and Monday after the clock change uses GMT, independent of server timezone', () => {
  expect(parseEditorialScheduleInput('2026-10-23T09:00')?.toISOString()).toBe('2026-10-23T08:00:00.000Z')
  expect(parseEditorialScheduleInput('2026-10-26T09:00')?.toISOString()).toBe('2026-10-26T09:00:00.000Z')
  expect(formatEditorialScheduleDisplay('2026-10-23T08:00:00Z', { includeZone: true })).toBe('23 Oct 2026, 09:00 BST')
  expect(parseEditorialScheduleInput('2027-03-28T01:30')).toBeNull()
  // The repeated autumn hour resolves to the later GMT occurrence; document this editorial convention.
  expect(parseEditorialScheduleInput('2026-10-25T01:30')?.toISOString()).toBe('2026-10-25T01:30:00.000Z')
})
