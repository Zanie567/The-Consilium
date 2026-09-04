/**
 * Market data for the homepage ticker.
 *
 * Source: the Yahoo Finance chart endpoint, which serves the cash indices
 * themselves rather than ETF proxies, so a displayed level is the real index
 * level. Quotes are delayed by the exchange's own delay (typically 15-20
 * minutes for indices); they are not real-time and must not be described as
 * such. No API key is involved, so nothing here is secret.
 */

export type InstrumentKind = 'index' | 'fx' | 'commodity'

export interface Instrument {
  label: string
  symbol: string
  kind: InstrumentKind
}

export interface MarketQuote {
  label: string
  kind: InstrumentKind
  value: number
  /** Provider-supplied change against the previous session close, in percent. */
  changePercent: number | null
  /** Provider's quote time, ISO 8601. */
  asOf: string
}

/**
 * GC=F is the COMEX front-month gold future, quoted in USD per troy ounce -
 * a few dollars off spot XAU/USD, which no keyless feed publishes.
 * FX symbols read base-first: USDCNY=X is CNY per USD.
 */
export const MARKET_INSTRUMENTS: Instrument[] = [
  { label: 'S&P 500',  symbol: '^GSPC',    kind: 'index' },
  { label: 'FTSE 100', symbol: '^FTSE',    kind: 'index' },
  { label: 'DAX',      symbol: '^GDAXI',   kind: 'index' },
  { label: 'NIKKEI',   symbol: '^N225',    kind: 'index' },
  { label: 'GBP/USD',  symbol: 'GBPUSD=X', kind: 'fx' },
  { label: 'EUR/USD',  symbol: 'EURUSD=X', kind: 'fx' },
  { label: 'USD/CNY',  symbol: 'USDCNY=X', kind: 'fx' },
  { label: 'USD/INR',  symbol: 'USDINR=X', kind: 'fx' },
  { label: 'GOLD',     symbol: 'GC=F',     kind: 'commodity' },
]

/**
 * A quote older than this is not presented as a current one. Seven days clears
 * any real exchange closure - weekend, public holiday, Golden Week - while
 * still catching a feed that has genuinely stopped. It is a backstop, not the
 * refresh mechanism: normal quotes are minutes old.
 */
export const MARKET_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Tolerate a little clock skew between the provider's clock and ours. */
const CLOCK_SKEW_MS = 60 * 1000

export function isFresh(asOf: string, maxAgeMs: number, now: number = Date.now()): boolean {
  const at = Date.parse(asOf)
  if (Number.isNaN(at)) return false
  const age = now - at
  return age >= -CLOCK_SKEW_MS && age <= maxAgeMs
}

interface YahooMeta {
  regularMarketPrice?: unknown
  regularMarketTime?: unknown
  regularMarketChangePercent?: unknown
}

function metaOf(json: unknown): YahooMeta | null {
  const result = (json as { chart?: { result?: unknown } } | null)?.chart?.result
  if (!Array.isArray(result) || result.length === 0) return null
  const meta = (result[0] as { meta?: unknown } | null)?.meta
  return meta && typeof meta === 'object' ? (meta as YahooMeta) : null
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Reads one chart response. Returns null unless a usable price and quote time
 * are both present, so a rate-limit or error body can never become a quote.
 */
export function parseYahooQuote(json: unknown, instrument: Instrument): MarketQuote | null {
  const meta = metaOf(json)
  if (!meta) return null
  const { regularMarketPrice: price, regularMarketTime: time, regularMarketChangePercent: pct } = meta
  if (!isFiniteNumber(price) || !isFiniteNumber(time)) return null
  return {
    label: instrument.label,
    kind: instrument.kind,
    value: price,
    changePercent: isFiniteNumber(pct) ? pct : null,
    asOf: new Date(time * 1000).toISOString(),
  }
}

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/'
// Yahoo rejects requests that send no User-Agent at all.
const USER_AGENT = 'TheConsilium/1.0 (+https://theconsilium.co.uk)'
const REQUEST_TIMEOUT_MS = 5000

async function fetchQuote(instrument: Instrument): Promise<MarketQuote | null> {
  const url = `${YAHOO_BASE}${encodeURIComponent(instrument.symbol)}?interval=1d&range=1d`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[ticker] ${instrument.symbol}: HTTP ${res.status}`)
      return null
    }
    const quote = parseYahooQuote(await res.json(), instrument)
    if (!quote) console.error(`[ticker] ${instrument.symbol}: no usable quote in response`)
    return quote
  } catch (err) {
    console.error(`[ticker] ${instrument.symbol}: ${err instanceof Error ? err.message : 'request failed'}`)
    return null
  }
}

/**
 * Fetches every instrument independently: one failure drops one item rather
 * than the whole ticker, and a stale quote is dropped rather than shown.
 */
export async function fetchMarketQuotes(now: number = Date.now()): Promise<MarketQuote[]> {
  const settled = await Promise.all(MARKET_INSTRUMENTS.map(fetchQuote))
  const quotes: MarketQuote[] = []
  for (const quote of settled) {
    if (!quote) continue
    if (!isFresh(quote.asOf, MARKET_MAX_AGE_MS, now)) {
      console.error(`[ticker] ${quote.label}: dropping stale quote from ${quote.asOf}`)
      continue
    }
    quotes.push(quote)
  }
  return quotes
}
