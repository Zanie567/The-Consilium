/**
 * Unit tests for the homepage ticker data pipeline.
 *
 * These assert the RULES - symbol mapping, parsing, freshness, direction - and
 * never a snapshot of today's market, so they stay valid as prices move.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  MARKET_INSTRUMENTS,
  MARKET_MAX_AGE_MS,
  fetchMarketQuotes,
  isFresh,
  parseYahooQuote,
  type Instrument,
} from '@/lib/marketData'
import {
  MACRO_SERIES,
  isObservationFresh,
  parseBoeCsv,
  parseFredObservations,
  parseBoeDate,
  parseOnsCsv,
  parseOnsPeriod,
} from '@/lib/macroData'
import { buildDisplayItems } from '@/components/ui/EconomicTicker'

const NOW = Date.parse('2026-09-03T12:00:00Z')
const spx: Instrument = { label: 'S&P 500', symbol: '^GSPC', kind: 'index' }

function yahoo(price: unknown, changePercent: unknown, at: string) {
  return {
    chart: {
      result: [{
        meta: {
          regularMarketPrice: price,
          regularMarketChangePercent: changePercent,
          regularMarketTime: Math.floor(Date.parse(at) / 1000),
        },
      }],
    },
  }
}

afterEach(() => { vi.restoreAllMocks() })

// ── Instrument mapping ──────────────────────────────────────────────────────

describe('instrument mapping', () => {
  it('maps each label to the cash index, not an ETF proxy', () => {
    const bySymbol = Object.fromEntries(MARKET_INSTRUMENTS.map((i) => [i.label, i.symbol]))
    expect(bySymbol['S&P 500']).toBe('^GSPC')
    expect(bySymbol['FTSE 100']).toBe('^FTSE')
    expect(bySymbol['DAX']).toBe('^GDAXI')
    expect(bySymbol['NIKKEI']).toBe('^N225')
    // SPY/EWU/EWG/EWJ were ETF stand-ins whose levels were not index levels.
    expect(Object.values(bySymbol)).not.toContain('SPY')
  })

  it('keeps FX pairs in base/quote order', () => {
    const bySymbol = Object.fromEntries(MARKET_INSTRUMENTS.map((i) => [i.label, i.symbol]))
    expect(bySymbol['GBP/USD']).toBe('GBPUSD=X')
    expect(bySymbol['USD/CNY']).toBe('USDCNY=X')
    expect(bySymbol['USD/INR']).toBe('USDINR=X')
  })

  it('carries no hard-coded prices in the instrument table', () => {
    for (const instrument of MARKET_INSTRUMENTS) {
      expect(Object.keys(instrument).sort()).toEqual(['kind', 'label', 'symbol'])
    }
  })
})

// ── Parsing ─────────────────────────────────────────────────────────────────

describe('parseYahooQuote', () => {
  it('reads price, change and quote time', () => {
    const quote = parseYahooQuote(yahoo(7747.71, 1.058, '2026-09-03T20:49:00Z'), spx)
    expect(quote).toEqual({
      label: 'S&P 500',
      kind: 'index',
      value: 7747.71,
      changePercent: 1.058,
      asOf: '2026-09-03T20:49:00.000Z',
    })
  })

  it('returns null for a rate-limit or error body rather than inventing a price', () => {
    expect(parseYahooQuote({ chart: { result: null, error: 'Too Many Requests' } }, spx)).toBeNull()
    expect(parseYahooQuote({ finance: { error: 'Unauthorized' } }, spx)).toBeNull()
    expect(parseYahooQuote('Too Many Requests', spx)).toBeNull()
    expect(parseYahooQuote(null, spx)).toBeNull()
  })

  it('rejects a malformed or missing price', () => {
    expect(parseYahooQuote(yahoo('7747.71', 1, '2026-09-03T20:49:00Z'), spx)).toBeNull()
    expect(parseYahooQuote(yahoo(NaN, 1, '2026-09-03T20:49:00Z'), spx)).toBeNull()
    expect(parseYahooQuote(yahoo(undefined, 1, '2026-09-03T20:49:00Z'), spx)).toBeNull()
  })

  it('rejects a quote with no timestamp, so freshness can never be assumed', () => {
    const body = yahoo(7747.71, 1.058, '2026-09-03T20:49:00Z')
    delete (body.chart.result[0].meta as Record<string, unknown>).regularMarketTime
    expect(parseYahooQuote(body, spx)).toBeNull()
  })

  it('keeps the price but nulls the change when the provider omits it', () => {
    const quote = parseYahooQuote(yahoo(7747.71, undefined, '2026-09-03T20:49:00Z'), spx)
    expect(quote?.value).toBe(7747.71)
    expect(quote?.changePercent).toBeNull()
  })
})

// ── Freshness ───────────────────────────────────────────────────────────────

describe('market freshness', () => {
  it('accepts a quote from minutes ago', () => {
    expect(isFresh('2026-09-03T11:45:00Z', MARKET_MAX_AGE_MS, NOW)).toBe(true)
  })

  it('accepts a Friday close read on the Sunday, and again after a Monday holiday', () => {
    const fridayClose = '2026-08-28T20:00:00Z'
    expect(isFresh(fridayClose, MARKET_MAX_AGE_MS, Date.parse('2026-08-30T12:00:00Z'))).toBe(true)
    expect(isFresh(fridayClose, MARKET_MAX_AGE_MS, Date.parse('2026-09-01T09:00:00Z'))).toBe(true)
  })

  it('rejects a quote that is months old', () => {
    expect(isFresh('2026-05-01T20:00:00Z', MARKET_MAX_AGE_MS, NOW)).toBe(false)
  })

  it('rejects an unparseable timestamp', () => {
    expect(isFresh('not-a-date', MARKET_MAX_AGE_MS, NOW)).toBe(false)
  })
})

// ── Whole-pipeline behaviour ────────────────────────────────────────────────

describe('fetchMarketQuotes', () => {
  function mockFetchPerSymbol(handler: (symbol: string) => { status?: number; body?: unknown } | 'throw') {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const symbol = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
      const outcome = handler(symbol)
      if (outcome === 'throw') throw new Error('network down')
      return {
        ok: (outcome.status ?? 200) < 400,
        status: outcome.status ?? 200,
        json: async () => outcome.body,
      }
    }))
  }

  it('returns a live price from the response, never a built-in constant', async () => {
    mockFetchPerSymbol(() => ({ body: yahoo(1234.5, 2, '2026-09-03T11:00:00Z') }))
    const quotes = await fetchMarketQuotes(NOW)
    expect(quotes).toHaveLength(MARKET_INSTRUMENTS.length)
    expect(quotes.every((q) => q.value === 1234.5)).toBe(true)
    // The pre-fix build showed 6817 for the S&P whenever upstream failed.
    expect(quotes.map((q) => q.value)).not.toContain(6817)
  })

  it('drops only the broken instrument when one symbol fails', async () => {
    mockFetchPerSymbol((symbol) =>
      symbol === '^FTSE' ? { status: 500 } : { body: yahoo(100, 1, '2026-09-03T11:00:00Z') })
    const quotes = await fetchMarketQuotes(NOW)
    expect(quotes).toHaveLength(MARKET_INSTRUMENTS.length - 1)
    expect(quotes.some((q) => q.label === 'FTSE 100')).toBe(false)
    expect(quotes.some((q) => q.label === 'S&P 500')).toBe(true)
  })

  it('survives a thrown request without losing the other instruments', async () => {
    mockFetchPerSymbol((symbol) =>
      symbol === 'GC=F' ? 'throw' : { body: yahoo(100, 1, '2026-09-03T11:00:00Z') })
    const quotes = await fetchMarketQuotes(NOW)
    expect(quotes.some((q) => q.label === 'GOLD')).toBe(false)
    expect(quotes).toHaveLength(MARKET_INSTRUMENTS.length - 1)
  })

  it('drops a stale quote instead of presenting it as current', async () => {
    mockFetchPerSymbol((symbol) =>
      symbol === '^N225'
        ? { body: yahoo(57175, 0.44, '2026-05-01T06:00:00Z') }
        : { body: yahoo(100, 1, '2026-09-03T11:00:00Z') })
    const quotes = await fetchMarketQuotes(NOW)
    expect(quotes.some((q) => q.label === 'NIKKEI')).toBe(false)
  })

  it('returns nothing at all when the provider is entirely unavailable', async () => {
    mockFetchPerSymbol(() => ({ status: 429, body: 'Too Many Requests' }))
    expect(await fetchMarketQuotes(NOW)).toEqual([])
  })
})

// ── Direction and percentage change ─────────────────────────────────────────

describe('display items', () => {
  const quote = (label: string, kind: 'index' | 'fx' | 'commodity', value: number, changePercent: number | null) =>
    ({ label, kind, value, changePercent, asOf: '2026-09-03T11:00:00Z' })

  it('shows a rising index green with its unsigned percentage', () => {
    const [item] = buildDisplayItems([quote('S&P 500', 'index', 7747.71, 1.058)], [], NOW)
    expect(item.direction).toBe('up')
    expect(item.value).toBe('7,748  ▲ 1.06%')
  })

  it('shows a falling index red, with no minus sign duplicating the arrow', () => {
    const [item] = buildDisplayItems([quote('DAX', 'index', 26003.32, -1.19)], [], NOW)
    expect(item.direction).toBe('down')
    expect(item.value).toBe('26,003  ▼ 1.19%')
  })

  it('shows an unchanged instrument as flat, not green or red', () => {
    const [item] = buildDisplayItems([quote('USD/CNY', 'fx', 6.7097, 0)], [], NOW)
    expect(item.direction).toBe('flat')
    expect(item.value).toBe('6.7097  ▶')
  })

  it('never contradicts the arrow with the sign of the change', () => {
    for (const change of [2.5, -2.5, 0]) {
      const [item] = buildDisplayItems([quote('FTSE 100', 'index', 10831.52, change)], [], NOW)
      const arrow = item.value.slice(-item.value.length).match(/[▲▼▶]/)?.[0]
      if (change > 0) expect(arrow).toBe('▲')
      else if (change < 0) expect(arrow).toBe('▼')
      else expect(arrow).toBe('▶')
    }
  })

  it('renders FX to four decimals and gold as a whole number', () => {
    const items = buildDisplayItems(
      [quote('GBP/USD', 'fx', 1.35297631, 0.02), quote('GOLD', 'commodity', 4526.3, -0.3)],
      [], NOW,
    )
    expect(items[0].value).toBe('1.3530  ▲')
    expect(items[1].value).toBe('4,526  ▼')
  })

  it('omits a stale quote at render time even if the server let it through', () => {
    const stale = { label: 'S&P 500', kind: 'index' as const, value: 6817, changePercent: -0.11, asOf: '2026-05-01T20:00:00Z' }
    expect(buildDisplayItems([stale], [], NOW)).toEqual([])
  })

  it('renders an empty ticker rather than placeholder numbers', () => {
    expect(buildDisplayItems([], [], NOW)).toEqual([])
  })
})

// ── Macro series ────────────────────────────────────────────────────────────

describe('macro parsing', () => {
  it('reads the newest FRED observation and the one before it', () => {
    expect(parseFredObservations({
      observations: [
        { date: '2026-07-01', value: '3.30386' },
        { date: '2026-06-01', value: '3.46353' },
      ],
    })).toEqual({ value: 3.30386, previousValue: 3.46353, observationDate: '2026-07-01' })
  })

  it('skips FRED placeholder values', () => {
    expect(parseFredObservations({
      observations: [{ date: '2026-08-01', value: '.' }, { date: '2026-07-01', value: '4.1' }],
    })).toEqual({ value: 4.1, previousValue: null, observationDate: '2026-07-01' })
  })

  it('returns null for a FRED error body', () => {
    expect(parseFredObservations({ error_code: 400, error_message: 'series does not exist' })).toBeNull()
    expect(parseFredObservations({ observations: [] })).toBeNull()
  })

  it('reads the last two rows of a Bank of England CSV', () => {
    expect(parseBoeCsv('DATE,IUDBEDR\n31 Aug 2026,4.00\n01 Sep 2026,3.75\n'))
      .toEqual({ value: 3.75, previousValue: 4, observationDate: '2026-09-01' })
  })

  it('reads BoE dates as UTC, whatever timezone the server runs in', () => {
    // Date.parse('01 Sep 2026') is local midnight, which lands on 31 August
    // once converted to UTC anywhere east of Greenwich.
    expect(parseBoeDate('01 Sep 2026')).toBe('2026-09-01')
    expect(parseBoeDate('2026-09-01')).toBe('2026-09-01')
    expect(parseBoeDate('1 Sep 2026')).toBe('2026-09-01')
    expect(parseBoeDate('rubbish')).toBeNull()
  })

  it('returns null when the BoE responds with no data rows', () => {
    expect(parseBoeCsv('')).toBeNull()
    expect(parseBoeCsv('DATE,IUDBEDR\n')).toBeNull()
  })

  it('reads only the monthly rows of an ONS CSV', () => {
    const csv = [
      '"Title","CPI ANNUAL RATE"',
      '"1989","5.2"',
      '"1994 Q2","2.0"',
      '"2026 JUN","2.6"',
      '"2026 JUL","2.9"',
    ].join('\n')
    expect(parseOnsCsv(csv)).toEqual({ value: 2.9, previousValue: 2.6, observationDate: '2026-07-01' })
  })

  it('parses ONS period labels and rejects nonsense', () => {
    expect(parseOnsPeriod('2026 JUL')).toBe('2026-07-01')
    expect(parseOnsPeriod('2026 XXX')).toBeNull()
    expect(parseOnsPeriod('nonsense')).toBeNull()
  })
})

describe('macro freshness', () => {
  it('accepts a CPI print published two months in arrears', () => {
    expect(isObservationFresh('2026-07-01', 'monthly', NOW)).toBe(true)
  })

  it('accepts UK labour data running a quarter behind', () => {
    expect(isObservationFresh('2026-05-01', 'monthly', NOW)).toBe(true)
  })

  it('rejects a monthly series that has been discontinued for over a year', () => {
    expect(isObservationFresh('2025-04-01', 'monthly', NOW)).toBe(false)
  })

  it('holds daily policy rates to a much tighter bound', () => {
    expect(isObservationFresh('2026-09-01', 'daily', NOW)).toBe(true)
    expect(isObservationFresh('2026-07-01', 'daily', NOW)).toBe(false)
  })

  it('gives every configured series a cadence', () => {
    for (const series of MACRO_SERIES) {
      expect(['daily', 'monthly']).toContain(series.cadence)
    }
  })

  it('drops a stale macro observation at render time', () => {
    const stale = { label: 'UK CPI', value: 3.0, previousValue: 3.2, unit: 'YOY' as const, observationDate: '2025-01-01' }
    expect(buildDisplayItems([], [stale], NOW)).toEqual([])
  })

  it('formats a fresh macro observation with its month-over-month direction', () => {
    const items = buildDisplayItems([], [
      { label: 'US CPI', value: 3.30386, previousValue: 3.46353, unit: 'YOY', observationDate: '2026-07-01' },
      { label: 'FEDERAL RESERVE', value: 3.63, previousValue: 3.63, unit: '%', observationDate: '2026-09-02' },
    ], NOW)
    expect(items[0].value).toBe('3.3% YOY  ▼')
    expect(items[0].direction).toBe('down')
    expect(items[1].value).toBe('3.63%  ▶')
    expect(items[1].direction).toBe('flat')
  })
})
