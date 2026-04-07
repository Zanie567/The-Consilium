/**
 * GET /api/ticker/markets
 *
 * Returns live market data for the economic ticker bar.
 * Upstream source: Alpha Vantage (https://www.alphavantage.co)
 *
 * Required environment variables:
 *   ALPHA_VANTAGE_API_KEY — free key from https://www.alphavantage.co/support/#api-key
 *
 * Rate limit notes (free tier = 25 requests/day):
 *   This route makes 9 upstream calls per refresh cycle:
 *     4 × GLOBAL_QUOTE  (index ETF proxies: SPY, EWU, EWG, EWJ)
 *     4 × CURRENCY_EXCHANGE_RATE  (GBP/USD, EUR/USD, USD/CNY, USD/INR)
 *     1 × CURRENCY_EXCHANGE_RATE  (XAU/USD — gold)
 *   At 6-hour refresh (4 cycles/day) = 36 calls/day, slightly over the free limit.
 *   If you hit "Thank you for using Alpha Vantage!" rate-limit responses, change
 *   MARKETS_REVALIDATE_SECONDS below to 43200 (12 hours) = 18 calls/day.
 *
 * Index pricing note:
 *   Alpha Vantage free tier does not serve raw index levels (e.g. FTSE 100 = 7,842).
 *   We use US-listed ETF proxies instead:
 *     SPY  → S&P 500   (price × 10 gives approximate index level)
 *     EWU  → FTSE 100  (% change is accurate; displayed price is a fixed approximate)
 *     EWG  → DAX       (same)
 *     EWJ  → Nikkei    (same)
 *   The displayed % changes are accurate. Absolute index levels are approximate.
 */

import { NextResponse } from 'next/server'

// Next.js ISR: cache the route response for 6 hours.
// Next.js requires a literal here — do not replace with a variable reference.
// To reduce Alpha Vantage usage (25 req/day free tier), change to 43200 (12 h).
export const revalidate = 21600

const AV_BASE = 'https://www.alphavantage.co/query'
const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY

// ── Index configuration ────────────────────────────────────────────────────

type IndexConfig =
  | { label: string; symbol: string; /** multiply ETF price by this to approximate index level */ multiplier: number }
  | { label: string; symbol: string; /** fixed display price — only % change is live */ basePrice: number }

const INDEX_CONFIG: IndexConfig[] = [
  // SPY is designed to track 1/10 of S&P 500, so ×10 is a stable approximation.
  { label: 'S&P 500', symbol: 'SPY', multiplier: 10 },
  // For these, ETF price (£30, $35, $65) doesn't map to the index level,
  // so we use a fixed base price and only take the live % change from the ETF.
  { label: 'FTSE 100', symbol: 'EWU', basePrice: 7842 },
  { label: 'DAX',      symbol: 'EWG', basePrice: 18245 },
  { label: 'NIKKEI',   symbol: 'EWJ', basePrice: 38451 },
]

const FOREX_PAIRS = [
  { pair: 'GBP/USD', from: 'GBP', to: 'USD' },
  { pair: 'EUR/USD', from: 'EUR', to: 'USD' },
  { pair: 'USD/CNY', from: 'USD', to: 'CNY' },
  { pair: 'USD/INR', from: 'USD', to: 'INR' },
]

// ── Fallback data (shown when API key is missing or calls fail) ────────────

const FALLBACK = {
  indices: [
    { label: 'S&P 500', price: 5234,  changePercent:  0.3 },
    { label: 'FTSE 100', price: 7842,  changePercent:  0.4 },
    { label: 'DAX',      price: 18245, changePercent:  0.2 },
    { label: 'NIKKEI',   price: 38451, changePercent: -0.1 },
  ],
  forex: [
    { pair: 'GBP/USD', rate: 1.2634 },
    { pair: 'EUR/USD', rate: 1.0821 },
    { pair: 'USD/CNY', rate: 7.2312 },
    { pair: 'USD/INR', rate: 83.45  },
  ],
  commodities: [
    { label: 'GOLD', price: 2342 },
  ],
} as const

// ── Alpha Vantage helpers ──────────────────────────────────────────────────

async function fetchGlobalQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
  if (!AV_KEY) return null
  try {
    const url = `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${AV_KEY}`
    const res = await fetch(url, { next: { revalidate: 21600 } })
    if (!res.ok) {
      console.error(`[ticker/markets] GLOBAL_QUOTE ${symbol} HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    const q = json?.['Global Quote']
    if (!q?.['05. price']) {
      // Alpha Vantage returns rate-limit messages as JSON without the expected keys
      console.error(`[ticker/markets] GLOBAL_QUOTE ${symbol} unexpected response:`, JSON.stringify(json).slice(0, 120))
      return null
    }
    const price = parseFloat(q['05. price'])
    const pct   = parseFloat((q['10. change percent'] ?? '0%').replace('%', ''))
    if (isNaN(price)) return null
    return { price, changePercent: isNaN(pct) ? 0 : pct }
  } catch (err) {
    console.error(`[ticker/markets] GLOBAL_QUOTE ${symbol} error:`, err)
    return null
  }
}

async function fetchForexRate(from: string, to: string): Promise<number | null> {
  if (!AV_KEY) return null
  try {
    const url = `${AV_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${AV_KEY}`
    const res = await fetch(url, { next: { revalidate: 21600 } })
    if (!res.ok) {
      console.error(`[ticker/markets] CURRENCY_EXCHANGE_RATE ${from}/${to} HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    const rate = json?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate']
    if (!rate) {
      console.error(`[ticker/markets] CURRENCY_EXCHANGE_RATE ${from}/${to} unexpected response:`, JSON.stringify(json).slice(0, 120))
      return null
    }
    const parsed = parseFloat(rate)
    return isNaN(parsed) ? null : parsed
  } catch (err) {
    console.error(`[ticker/markets] CURRENCY_EXCHANGE_RATE ${from}/${to} error:`, err)
    return null
  }
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Fire all upstream requests in parallel to minimise latency
    const [indexResults, forexResults, goldRate] = await Promise.all([
      Promise.all(INDEX_CONFIG.map((cfg) => fetchGlobalQuote(cfg.symbol))),
      Promise.all(FOREX_PAIRS.map((p)   => fetchForexRate(p.from, p.to))),
      fetchForexRate('XAU', 'USD'),
    ])

    const indices = INDEX_CONFIG.map((cfg, i) => {
      const live = indexResults[i]
      if (live) {
        const price = 'multiplier' in cfg
          ? Math.round(live.price * cfg.multiplier)
          : cfg.basePrice                              // keep fixed price, use live % change
        return { label: cfg.label, price, changePercent: live.changePercent }
      }
      return { ...FALLBACK.indices[i] }
    })

    const forex = FOREX_PAIRS.map((p, i) => ({
      pair: p.pair,
      rate: forexResults[i] ?? FALLBACK.forex[i].rate,
    }))

    const commodities = [{
      label: 'GOLD',
      price: goldRate ? Math.round(goldRate) : FALLBACK.commodities[0].price,
    }]

    return NextResponse.json({
      indices,
      forex,
      commodities,
      source:    AV_KEY ? 'alpha_vantage' : 'fallback',
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    // Never return an error to the frontend — fall back to hardcoded data
    console.error('[ticker/markets] Unhandled error, returning fallback:', err)
    return NextResponse.json({
      ...FALLBACK,
      source:    'fallback',
      updatedAt: new Date().toISOString(),
    })
  }
}
