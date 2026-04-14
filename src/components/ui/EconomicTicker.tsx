'use client'

/**
 * EconomicTicker — FT-style continuously scrolling bar showing live economic data.
 *
 * Data sources (via internal API routes, cached server-side):
 *   /api/ticker/markets — Alpha Vantage: indices, forex, gold
 *   /api/ticker/macro   — FRED: CPI, unemployment, central bank rates
 *
 * Directional arrows (▲/▼):
 *   - Indices    : built-in changePercent from Alpha Vantage (day-over-day)
 *   - Forex/Gold : localStorage comparison — direction vs previous 6-hour fetch
 *   - Macro      : previousValue returned by FRED endpoint (month-over-month)
 *   Every metric always shows an arrow; colour is green (up) or red (down).
 *
 * Behaviour:
 *   - Shows fallback static data immediately; replaces with live data once fetched
 *   - Pauses animation on hover so users can read individual data points
 *   - prefers-reduced-motion: shows a static overflow-scrollable bar instead
 *   - Client-side refresh every 6 hours (server routes are also ISR-cached)
 */

import { useEffect, useState, useRef } from 'react'

// ── Data types ──────────────────────────────────────────────────────────────

interface IndexItem     { label: string; price: number; changePercent: number }
interface ForexItem     { pair: string;  rate: number }
interface CommodityItem { label: string; price: number }
interface MacroItem     { label: string; value: number; previousValue: number | null; unit: 'YOY' | '%' }

interface MarketsData {
  indices:     IndexItem[]
  forex:       ForexItem[]
  commodities: CommodityItem[]
}

interface MacroData {
  data: MacroItem[]
}

// ── Fallback data ───────────────────────────────────────────────────────────

const FALLBACK_MARKETS: MarketsData = {
  indices: [
    { label: 'S&P 500',  price: 6817,  changePercent: -0.11 },
    { label: 'FTSE 100', price: 10583, changePercent: -0.17 },
    { label: 'DAX',      price: 23521, changePercent: -1.19 },
    { label: 'NIKKEI',   price: 57175, changePercent:  0.44 },
  ],
  forex: [
    { pair: 'GBP/USD', rate: 1.3508 },
    { pair: 'EUR/USD', rate: 1.1760 },
    { pair: 'USD/CNY', rate: 6.8183 },
    { pair: 'USD/INR', rate: 93.22  },
  ],
  commodities: [
    { label: 'GOLD', price: 4733 },
  ],
}

const FALLBACK_MACRO: MacroData = {
  data: [
    { label: 'FED RATE',        value: 3.75, previousValue: 4.00, unit: '%'   },
    { label: 'BOE RATE',        value: 3.75, previousValue: 4.00, unit: '%'   },
    { label: 'ECB RATE',        value: 2.00, previousValue: 2.25, unit: '%'   },
    { label: 'US CPI',          value: 3.3,  previousValue: 3.5,  unit: 'YOY' },
    { label: 'UK CPI',          value: 3.0,  previousValue: 3.2,  unit: 'YOY' },
    { label: 'US UNEMPLOYMENT', value: 4.3,  previousValue: 4.1,  unit: '%'   },
    { label: 'UK UNEMPLOYMENT', value: 5.2,  previousValue: 5.0,  unit: '%'   },
  ],
}

// ── localStorage helpers for forex/commodity direction tracking ─────────────

const LS_KEY = 'consilium_ticker_prev_v2'

interface StoredPrev {
  forex: Record<string, number>
  commodities: Record<string, number>
  ts: number
}

function readPrev(): StoredPrev | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as StoredPrev) : null
  } catch { return null }
}

function writePrev(markets: MarketsData) {
  if (typeof window === 'undefined') return
  try {
    const stored: StoredPrev = {
      forex:       Object.fromEntries(markets.forex.map((f) => [f.pair,  f.rate])),
      commodities: Object.fromEntries(markets.commodities.map((c) => [c.label, c.price])),
      ts: Date.now(),
    }
    localStorage.setItem(LS_KEY, JSON.stringify(stored))
  } catch { /* ignore quota errors */ }
}

// ── Direction helpers ───────────────────────────────────────────────────────

type Dir = 'up' | 'down' | 'flat'

function dir(current: number, previous: number | null | undefined): Dir {
  if (previous == null) return 'flat'
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'flat'
}

const UP_COLOR   = '#22c55e'   // Tailwind green-500
const DOWN_COLOR = '#ef4444'   // Tailwind red-500
const FLAT_COLOR = '#9ca3af'   // Tailwind gray-400

function arrowColor(d: Dir) {
  if (d === 'up')   return UP_COLOR
  if (d === 'down') return DOWN_COLOR
  return FLAT_COLOR
}

function arrowSymbol(d: Dir) {
  if (d === 'up')   return '▲'
  if (d === 'down') return '▼'
  return '▶'
}

// ── Display item type ───────────────────────────────────────────────────────

interface DisplayItem {
  key:       string
  label:     string
  value:     string
  direction: Dir
}

function buildDisplayItems(
  markets: MarketsData,
  macro:   MacroData,
  prev:    StoredPrev | null,
): DisplayItem[] {
  const items: DisplayItem[] = []

  // Indices — direction from built-in changePercent (day-over-day)
  for (const idx of markets.indices) {
    const d = idx.changePercent > 0 ? 'up' : idx.changePercent < 0 ? 'down' : 'flat'
    const pct = Math.abs(idx.changePercent).toFixed(2)
    items.push({
      key:       idx.label,
      label:     idx.label,
      value:     `${Math.round(idx.price).toLocaleString('en-GB')}  ${arrowSymbol(d as Dir)} ${pct}%`,
      direction: d as Dir,
    })
  }

  // Forex — direction from localStorage comparison
  for (const fx of markets.forex) {
    const prevRate = prev?.forex?.[fx.pair] ?? null
    const d = dir(fx.rate, prevRate)
    items.push({
      key:       fx.pair,
      label:     fx.pair,
      value:     `${fx.rate.toFixed(4)}  ${arrowSymbol(d)}`,
      direction: d,
    })
  }

  // Commodities — direction from localStorage comparison
  for (const c of markets.commodities) {
    const prevPrice = prev?.commodities?.[c.label] ?? null
    const d = dir(c.price, prevPrice)
    items.push({
      key:       c.label,
      label:     c.label,
      value:     `${Math.round(c.price).toLocaleString('en-GB')}  ${arrowSymbol(d)}`,
      direction: d,
    })
  }

  // Macro — direction from previousValue returned by FRED API
  for (const m of macro.data) {
    const d = dir(m.value, m.previousValue)
    const formatted = m.unit === 'YOY'
      ? `${m.value.toFixed(1)}% YOY`
      : `${m.value.toFixed(2)}%`
    items.push({
      key:       m.label,
      label:     m.label,
      value:     `${formatted}  ${arrowSymbol(d)}`,
      direction: d,
    })
  }

  return items
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Separator() {
  return (
    <span
      className="shrink-0 select-none px-3 text-[var(--fg-faint)]"
      aria-hidden
      style={{ fontSize: '10px' }}
    >
      ·
    </span>
  )
}

function Item({ item }: { item: DisplayItem }) {
  const color = arrowColor(item.direction)
  // Split the value on the arrow symbol to colour just the arrow+suffix
  const arrowIdx = item.value.lastIndexOf('  ')
  const mainText = arrowIdx >= 0 ? item.value.slice(0, arrowIdx) : item.value
  const arrowText = arrowIdx >= 0 ? item.value.slice(arrowIdx) : ''

  return (
    <span className="flex items-center shrink-0">
      <span
        className="whitespace-nowrap"
        style={{ fontSize: '12px', letterSpacing: '0.02em' }}
      >
        <span className="text-[var(--fg)]">{item.label}  {mainText}</span>
        {arrowText && (
          <span style={{ color }} aria-hidden>
            {arrowText}
          </span>
        )}
      </span>
      <Separator />
    </span>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function EconomicTicker() {
  const [markets, setMarkets] = useState<MarketsData>(FALLBACK_MARKETS)
  const [macro,   setMacro  ] = useState<MacroData>(FALLBACK_MACRO)
  const [prev,    setPrev   ] = useState<StoredPrev | null>(null)
  const [paused,  setPaused ] = useState(false)
  const [prefersReduced, setPrefersReduced] = useState(false)

  // Hydrate localStorage-stored previous values on mount
  useEffect(() => {
    setPrev(readPrev())
  }, [])

  // Detect prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Fetch live data on mount, then refresh every 6 hours
  useEffect(() => {
    async function fetchAll() {
      const [mktResult, macResult] = await Promise.allSettled([
        fetch('/api/ticker/markets'),
        fetch('/api/ticker/macro'),
      ])

      let newMarkets: MarketsData | null = null
      if (mktResult.status === 'fulfilled' && mktResult.value.ok) {
        try { newMarkets = await mktResult.value.json() } catch { /* keep fallback */ }
      }
      if (macResult.status === 'fulfilled' && macResult.value.ok) {
        try { setMacro(await macResult.value.json()) } catch { /* keep fallback */ }
      }

      if (newMarkets) {
        // Store current as previous BEFORE updating state, so the direction
        // arrows reflect "previous fetch → current fetch" correctly.
        // On the very first fetch we read from localStorage (already in prev state).
        writePrev(newMarkets)
        setMarkets(newMarkets)
        // Update the prev state for the next render cycle
        setPrev(readPrev())
      }
    }
    fetchAll()
    const id = setInterval(fetchAll, 6 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const items = buildDisplayItems(markets, macro, prev)

  const wrapperStyle: React.CSSProperties = {
    background:   'var(--bg-subtle)',
    height:       '30px',
    display:      'flex',
    alignItems:   'center',
    width:        '100%',
    overflow:     'hidden',
    borderBottom: '1px solid var(--border)',
  }

  const label = (
    <div
      aria-hidden
      style={{
        flexShrink:    0,
        display:       'flex',
        alignItems:    'center',
        padding:       '0 12px',
        height:        '100%',
        borderRight:   '1px solid var(--border)',
        color:         'var(--fg-faint)',
        fontSize:      '10px',
        fontWeight:    700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace:    'nowrap',
      }}
    >
      MARKETS
    </div>
  )

  // ── Reduced-motion variant ─────────────────────────────────────────────
  if (prefersReduced) {
    return (
      <div
        role="region"
        aria-label="Live economic data ticker"
        style={{ ...wrapperStyle, overflow: 'hidden' }}
      >
        {label}
        <div
          style={{ flex: 1, overflowX: 'auto', display: 'flex', alignItems: 'center', scrollbarWidth: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 'max-content' }}>
            {items.map((item) => <Item key={item.key} item={item} />)}
          </div>
        </div>
      </div>
    )
  }

  // ── Animated scrolling ticker ─────────────────────────────────────────
  return (
    <div
      role="marquee"
      aria-label="Live economic data ticker"
      style={wrapperStyle}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {label}
      <div style={{ flex: 1, overflow: 'hidden', height: '100%', display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            display:            'flex',
            width:              'max-content',
            animation:          'consilium-ticker 60s linear infinite',
            animationPlayState: paused ? 'paused' : 'running',
            willChange:         'transform',
          }}
        >
          {/* Copy 1 — readable by screen readers */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {items.map((item) => <Item key={item.key} item={item} />)}
          </div>
          {/* Copy 2 — seamless loop duplicate */}
          <div style={{ display: 'flex', alignItems: 'center' }} aria-hidden>
            {items.map((item) => <Item key={`d-${item.key}`} item={item} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
