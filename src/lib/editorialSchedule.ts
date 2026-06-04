const EDITORIAL_TIME_ZONE = 'Europe/London'
export const EDITORIAL_TIME_ZONE_LABEL = 'UK time (Europe/London)'

interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: EDITORIAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function normaliseDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value)
}

function getTimeZoneParts(date: Date): DateParts {
  const values = partsFormatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

function formatPartsForInput(parts: DateParts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

function getTimeZoneOffset(date: Date) {
  const parts = getTimeZoneParts(date)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - date.getTime()
}

export function formatEditorialScheduleInput(date: Date | string | null | undefined) {
  if (!date) return ''
  return formatPartsForInput(getTimeZoneParts(normaliseDate(date)))
}

export function getEditorialScheduleMinInput(minutesAhead = 1) {
  return formatEditorialScheduleInput(new Date(Date.now() + minutesAhead * 60_000))
}

export function parseEditorialScheduleInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  const firstOffset = getTimeZoneOffset(new Date(utcGuess))
  let resolved = new Date(utcGuess - firstOffset)
  const secondOffset = getTimeZoneOffset(resolved)

  if (secondOffset !== firstOffset) {
    resolved = new Date(utcGuess - secondOffset)
  }

  return formatEditorialScheduleInput(resolved) === value ? resolved : null
}

export function formatEditorialScheduleDisplay(
  date: Date | string | null | undefined,
  options: { includeYear?: boolean; includeZone?: boolean } = {},
) {
  if (!date) return ''

  const { includeYear = true, includeZone = false } = options
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: EDITORIAL_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(includeZone ? { timeZoneName: 'short' } : {}),
  }).format(normaliseDate(date))
}
