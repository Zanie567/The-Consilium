import {
  formatEditorialScheduleInput,
  parseEditorialScheduleInput,
} from '@/lib/editorialSchedule'

// Helpers for the editorial calendar month view. All wall-clock reasoning
// happens in the editorial time zone (Europe/London, via editorialSchedule);
// the grid itself is plain calendar math on year/month/day numbers.

export interface CalendarDay {
  /** ISO date key, e.g. "2026-06-09" */
  key: string
  dayOfMonth: number
  /** True when the day belongs to the displayed month (not spillover). */
  inMonth: boolean
  /** Saturday or Sunday. */
  isWeekend: boolean
}

const MONTH_PARAM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isValidMonthParam(value: string): boolean {
  const match = MONTH_PARAM_RE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  return year >= 2000 && year <= 2100
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

/**
 * True when a "YYYY-MM-DD" string is a date that actually exists. The shape
 * regex alone accepts impossible values like 2026-13-99 or 2026-02-30, so this
 * round-trips the components through the calendar to reject them.
 */
export function isRealCalendarDate(key: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  )
}

function toKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Current month in the editorial time zone, as "YYYY-MM". */
export function currentEditorialMonth(now: Date = new Date()): string {
  return formatEditorialScheduleInput(now).slice(0, 7)
}

/** Date key ("YYYY-MM-DD") of an instant, in the editorial time zone. */
export function editorialDateKey(date: Date): string {
  return formatEditorialScheduleInput(date).slice(0, 10)
}

/** Wall-clock time label ("HH:mm") of an instant, in the editorial time zone. */
export function editorialTimeLabel(date: Date): string {
  return formatEditorialScheduleInput(date).slice(11, 16)
}

export function monthLabel(ym: string): string {
  const [year, month] = ym.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function addMonths(ym: string, delta: number): string {
  const [year, month] = ym.split('-').map(Number)
  const index = year * 12 + (month - 1) + delta
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

/**
 * Build the visible month grid: full weeks starting on Monday, covering the
 * whole month. Spillover days from the previous and next month are included
 * so every row has seven cells. Months render with 4, 5, or 6 rows depending
 * on where the 1st falls, exactly the rows needed and no more.
 */
export function buildMonthGrid(ym: string): CalendarDay[][] {
  const [year, month] = ym.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1, 1))
  // Days to step back from the 1st to reach Monday (getUTCDay: Sunday is 0).
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const cursor = new Date(Date.UTC(year, month - 1, 1 - mondayOffset))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastOfMonth = Date.UTC(year, month - 1, daysInMonth)

  const weeks: CalendarDay[][] = []
  while (cursor.getTime() <= lastOfMonth) {
    const week: CalendarDay[] = []
    for (let i = 0; i < 7; i++) {
      const dow = cursor.getUTCDay()
      week.push({
        key: toKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()),
        dayOfMonth: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month - 1 && cursor.getUTCFullYear() === year,
        isWeekend: dow === 0 || dow === 6,
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/**
 * UTC instants covering the visible grid: [start of the first cell's day,
 * start of the day after the last cell), measured in the editorial time zone.
 * Midnight always exists in Europe/London (DST shifts happen at 01:00), so
 * the parses cannot fail for real grids; the throw guards future tz changes.
 */
export function gridUtcRange(weeks: CalendarDay[][]): { start: Date; end: Date } {
  const firstKey = weeks[0][0].key
  const lastKey = weeks[weeks.length - 1][6].key
  const [y, m, d] = lastKey.split('-').map(Number)
  const after = new Date(Date.UTC(y, m - 1, d + 1))
  const afterKey = toKey(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate())

  const start = parseEditorialScheduleInput(`${firstKey}T00:00`)
  const end = parseEditorialScheduleInput(`${afterKey}T00:00`)
  if (!start || !end) {
    throw new Error(`Could not resolve calendar range for ${firstKey}..${afterKey}`)
  }
  return { start, end }
}

/**
 * Move an instant to a different calendar day while keeping its wall-clock
 * time in the editorial time zone. Returns null when the combination is
 * invalid or does not exist (a time skipped by a DST jump on the target day).
 */
export function moveToEditorialDate(current: Date, targetKey: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetKey)) return null
  const time = formatEditorialScheduleInput(current).slice(11, 16)
  return parseEditorialScheduleInput(`${targetKey}T${time}`)
}
