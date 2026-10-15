/**
 * Dates for the editorial calendar E2E test, derived from the real clock in the editorial time zone (Europe/London).
 *
 * The server decides what "past" means with its own clock (`PATCH /api/editorial/calendar` refuses a move that lands at
 * or before `new Date()`), and the browser takes "today" from the server (`todayKey`). The test runs on the same machine
 * as the server, so it must use the same real clock, never a fixed date: a fixed date eventually becomes today or the
 * past (issue #135: `2026-10-15T12:30Z` became "today", where articles published by earlier tests filled the cell, and
 * the fixture's chip was hidden behind "+2 more"). The calendar's own helpers do the date maths, so DST and month ends
 * resolve exactly as they do in the app.
 */
import { addMonths, buildMonthGrid, currentEditorialMonth, editorialDateKey } from '../../../src/lib/editorialCalendar'
import { parseEditorialScheduleInput } from '../../../src/lib/editorialSchedule'

function at(key: string, time: string): Date {
  const date = parseEditorialScheduleInput(`${key}T${time}`)
  if (!date) throw new Error(`no such editorial time: ${key} ${time}`)
  return date
}

/** The accessible name of a calendar day cell starts with this heading (see CalendarView's formatDayHeading). */
export function dayCellName(key: string): RegExp {
  const [y, m, d] = key.split('-').map(Number)
  const heading = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)))
  return new RegExp(`^${heading},`)
}

/**
 * A successful drag: the 15th to the 16th at 12:30, two months after the current editorial month. Always in the future,
 * on days no other test fills, and both days exist in every month.
 */
export function futureReschedule(now: Date) {
  const month = addMonths(currentEditorialMonth(now), 2)
  const fromKey = `${month}-15`
  const toKey = `${month}-16`
  return { month, fromKey, toKey, from: at(fromKey, '12:30'), to: at(toKey, '12:30') }
}

/**
 * A refused drag, on the current month's grid: an article scheduled at 00:00 is dragged onto a day whose 00:00 has
 * already passed. Normally the source is tomorrow (not yet due) and the target is today. 00:00 is the earliest time a
 * chip can have, so the fixture is the first chip in its cell and is never hidden behind "+N more", and the target
 * stays in the past even if midnight passes while the test runs.
 *
 * When today is the grid's last cell (a Sunday that ends the month), no later day is on screen. The source is then
 * today at 00:00, already due, and the target is yesterday. That is safe because nothing publishes due articles while
 * this test runs: only `/api/publish-scheduled` does, tests call it explicitly, and the suite runs on one worker.
 */
export function pastDrop(now: Date) {
  const month = currentEditorialMonth(now)
  const cells = buildMonthGrid(month).flat().map((day) => day.key)
  const today = editorialDateKey(now)
  const i = cells.indexOf(today)
  if (i === -1) throw new Error(`today (${today}) is not on the ${month} grid`)
  const last = i === cells.length - 1
  const sourceKey = last ? today : cells[i + 1]
  const targetKey = last ? cells[i - 1] : today
  return { month, sourceKey, targetKey, source: at(sourceKey, '00:00'), target: at(targetKey, '00:00') }
}
