/**
 * Weekly edition timing, in UK time whatever the server's time zone. The edition key is the London date
 * of the Friday, so a daylight-saving change or a server in another zone can never produce two keys (and
 * two sends) for one week.
 */
import { PUBLICATION_SAFE_DELAY_MS, WEEKLY_SEND_HOUR, WEEKLY_SEND_MINUTE, WEEKLY_SEND_WEEKDAY } from './config'

const ZONE = 'Europe/London'
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

interface LondonParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

function londonParts(date: Date): LondonParts {
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) if (part.type !== 'literal') parts[part.type] = part.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
  }
}

/** Offset of London from UTC at `date`, in minutes (0 in winter, 60 in summer). */
function londonOffsetMinutes(date: Date): number {
  const p = londonParts(date)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

/** The UTC instant at which London wall-clock time reads the given values. */
export function londonWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = guess - londonOffsetMinutes(new Date(guess)) * 60000
  const corrected = guess - londonOffsetMinutes(new Date(candidate)) * 60000
  if (corrected !== candidate) candidate = corrected
  return new Date(candidate)
}

export interface WeeklySlot {
  /** `weekly:YYYY-MM-DD`, the London date of the Friday. */
  editionKey: string
  fridayLabel: string
  sendAt: Date
  /** Articles must be published at or before this instant (sendAt minus the safe delay). */
  cutoff: Date
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

/** The edition whose Friday is the most recent London Friday on or before `now`. */
export function currentWeeklySlot(now: Date): WeeklySlot {
  const p = londonParts(now)
  const back = (p.weekday - WEEKLY_SEND_WEEKDAY + 7) % 7
  // Calendar arithmetic on the London date (noon UTC avoids any DST edge while stepping days).
  const friday = new Date(Date.UTC(p.year, p.month - 1, p.day, 12) - back * 24 * 60 * 60 * 1000)
  const y = friday.getUTCFullYear()
  const m = friday.getUTCMonth() + 1
  const d = friday.getUTCDate()
  const sendAt = londonWallTimeToUtc(y, m, d, WEEKLY_SEND_HOUR, WEEKLY_SEND_MINUTE)
  return {
    editionKey: `weekly:${y}-${pad(m)}-${pad(d)}`,
    fridayLabel: new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(sendAt),
    sendAt,
    cutoff: new Date(sendAt.getTime() - PUBLICATION_SAFE_DELAY_MS),
  }
}

/** The London date in an edition key, as a Date at that day's send time. */
export function slotForEditionKey(editionKey: string): WeeklySlot | null {
  const match = /^weekly:(\d{4})-(\d{2})-(\d{2})$/.exec(editionKey)
  if (!match) return null
  const sendAt = londonWallTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), WEEKLY_SEND_HOUR, WEEKLY_SEND_MINUTE)
  return { ...currentWeeklySlot(sendAt), sendAt }
}
