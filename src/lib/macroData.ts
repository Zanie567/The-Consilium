/**
 * Macroeconomic series for the homepage ticker.
 *
 * These are published observations, not market quotes: a CPI print stands as
 * the current reading for weeks. Each observation therefore carries the period
 * it describes, and freshness is judged against the series' own release
 * cadence rather than a market clock.
 *
 * Sources: FRED (needs FRED_API_KEY, server-side only), the Bank of England
 * IADB and the ONS CSV generator (both keyless).
 */

export type Cadence = 'daily' | 'monthly'

export interface SeriesConfig {
  label: string
  seriesId: string
  unit: 'YOY' | '%'
  cadence: Cadence
  source: 'fred' | 'boe' | 'ons'
  /** FRED units parameter; 'pc1' converts an index level to year-over-year %. */
  fredUnits?: string
  /** ONS website path for the series. */
  onsUri?: string
}

export interface MacroObservation {
  label: string
  value: number
  previousValue: number | null
  unit: 'YOY' | '%'
  /** The period the observation describes, ISO 8601 date. */
  observationDate: string
}

export const MACRO_SERIES: SeriesConfig[] = [
  { label: 'US CPI', seriesId: 'CPIAUCSL', unit: 'YOY', cadence: 'monthly', source: 'fred', fredUnits: 'pc1' },
  { label: 'UK CPI', seriesId: 'D7G7', unit: 'YOY', cadence: 'monthly', source: 'ons',
    onsUri: '/economy/inflationandpriceindices/timeseries/d7g7/mm23' },
  { label: 'US UNEMPLOYMENT', seriesId: 'UNRATE', unit: '%', cadence: 'monthly', source: 'fred' },
  { label: 'UK UNEMPLOYMENT', seriesId: 'MGSX', unit: '%', cadence: 'monthly', source: 'ons',
    onsUri: '/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms' },
  { label: 'FEDERAL RESERVE', seriesId: 'DFF', unit: '%', cadence: 'daily', source: 'fred' },
  { label: 'BANK OF ENGLAND', seriesId: 'IUDBEDR', unit: '%', cadence: 'daily', source: 'boe' },
  { label: 'ECB RATE', seriesId: 'ECBDFR', unit: '%', cadence: 'daily', source: 'fred' },
]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Daily policy rates should never be more than a fortnight behind. Monthly
 * series are allowed much longer: UK labour-market data routinely runs a
 * quarter in arrears, and CPI a couple of months, so the bound is set to catch
 * a series that has been discontinued rather than one that is merely lagging.
 */
export const MACRO_MAX_AGE_DAYS: Record<Cadence, number> = { daily: 14, monthly: 200 }

export function isObservationFresh(
  observationDate: string,
  cadence: Cadence,
  now: number = Date.now(),
): boolean {
  const at = Date.parse(observationDate)
  if (Number.isNaN(at)) return false
  const age = now - at
  return age >= -DAY_MS && age <= MACRO_MAX_AGE_DAYS[cadence] * DAY_MS
}

export interface SeriesReading {
  value: number
  previousValue: number | null
  observationDate: string
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Turns an ONS period label such as "2026 JUL" into an ISO date. */
export function parseOnsPeriod(period: string): string | null {
  const match = /^(\d{4})\s+([A-Z]{3})$/.exec(period.trim().toUpperCase())
  if (!match) return null
  const month = MONTHS.indexOf(match[2])
  if (month < 0) return null
  return `${match[1]}-${String(month + 1).padStart(2, '0')}-01`
}

export function parseFredObservations(json: unknown): SeriesReading | null {
  const rows = (json as { observations?: unknown } | null)?.observations
  if (!Array.isArray(rows)) return null
  const usable = rows
    .map((row) => row as { date?: unknown; value?: unknown })
    .filter((row) => typeof row.date === 'string' && typeof row.value === 'string' && row.value !== '.')
    .map((row) => ({ date: row.date as string, value: parseFloat(row.value as string) }))
    .filter((row) => Number.isFinite(row.value))
  if (usable.length === 0) return null
  // FRED is queried newest-first.
  return {
    value: usable[0].value,
    previousValue: usable.length > 1 ? usable[1].value : null,
    observationDate: usable[0].date,
  }
}

const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Bank of England dates arrive as "01 Sep 2026" (and occasionally ISO). Both
 * are read as UTC: letting the host's timezone decide would shift a date by a
 * day whenever the server runs behind UTC, silently mis-dating the reading.
 */
export function parseBoeDate(raw: string): string | null {
  const text = raw.trim().replace(/"/g, '')
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = /^(\d{1,2})[\s/-]([A-Za-z]{3})[a-z]*[\s/-](\d{4})$/.exec(text)
  if (!dmy) return null
  const month = SHORT_MONTHS.indexOf(dmy[2].toLowerCase())
  if (month < 0) return null
  const day = Number(dmy[1])
  if (day < 1 || day > 31) return null
  return `${dmy[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Bank of England IADB CSV: a "DATE,CODE" header then ascending daily rows. */
export function parseBoeCsv(csv: string): SeriesReading | null {
  const rows = csv.trim().split('\n').slice(1)
    .map((row) => row.split(','))
    .filter((cells) => cells.length >= 2 && Number.isFinite(parseFloat(cells[1])))
    .map((cells) => ({ date: cells[0], value: parseFloat(cells[1]) }))
  if (rows.length === 0) return null
  const latest = rows[rows.length - 1]
  const observationDate = parseBoeDate(latest.date)
  if (!observationDate) return null
  return {
    value: latest.value,
    previousValue: rows.length > 1 ? rows[rows.length - 2].value : null,
    observationDate,
  }
}

/**
 * ONS CSV: metadata rows, then annual, quarterly and finally monthly rows.
 * Only monthly rows ("2026 JUL","2.9") are used, ascending.
 */
export function parseOnsCsv(csv: string): SeriesReading | null {
  const rows = csv.split('\n')
    .map((row) => /^"(\d{4} [A-Z]{3})","?(-?[\d.]+)"?/.exec(row.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ period: match[1], value: parseFloat(match[2]) }))
    .filter((row) => Number.isFinite(row.value))
  if (rows.length === 0) return null
  const latest = rows[rows.length - 1]
  const observationDate = parseOnsPeriod(latest.period)
  if (!observationDate) return null
  return {
    value: latest.value,
    previousValue: rows.length > 1 ? rows[rows.length - 2].value : null,
    observationDate,
  }
}
