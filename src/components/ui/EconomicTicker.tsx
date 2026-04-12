'use client'

/**
 * EconomicTicker — FT-style continuously scrolling bar showing live economic data.
 *
 * Data sources (via internal API routes, cached server-side):
 *   /api/ticker/markets — Alpha Vantage: indices, forex, gold
 *   /api/ticker/macro   — FRED: CPI, unemployment, central bank rates
 *
 * Behaviour:
 *   - Shows fallback static data immediately; replaces with live data once fetched
 *   - Pauses animation on hover so users can read individual data points
 *   - prefers-reduced-motion: shows a static overflow-scrollable bar instead
 *   - Client-side refresh every 6 hours (server routes are also ISR-cached)
 *   - Homepage only — do not render on other routes; import only from page.tsx
 *
 * IMPORTANT (API keys):
 *   ALPHA_VANTAGE_API_KEY and FRED_API_KEY must be set in:
 *     - .env.local for local development
 *     - Vercel Dashboard > Settings > Environment Variables for production/preview
 *   The ticker falls back to static placeholder data if keys are missing or API calls fail.
 */

import { useEffect, useState } from 'react'

// ── Data types ──────────────────────────────────────────────────────────────

interface IndexItem     { label: string; price: number; changePercent: number }
interface ForexItem     { pair: string;  rate: number }
interface CommodityItem { label: string; price: number }
interface MacroItem     { label: string; value: number; unit: 'YOY' | '%' }

interface MarketsData {
  indices:     IndexItem[]
  forex:       ForexItem[]
  commodities: CommodityItem[]
}

interface MacroData {
  data: MacroItem[]
}

// ── Fallback data ───────────────────────────────────────────────────────────
// Rendered immediately on first paint and whenever both APIs are unavailable.

const FALLBACK_MARKETS: MarketsData = {
  indices: [
    { label: 'S&P 500',  price: 5234,  changePercent:  0.3 },
    { label: 'FTSE 100', price: 7842,  changePercent:  0.4 },
    { label: 'DAX',      price: 18245, changePercent:  0.2 },
    { label: 'NIKKEI',   price: 38451, changePercent: -0.1 },
  ],
  forex: [
    { pair: 'GBP/USD', rate: 1.2634 },
    { pair: 'EUR/USD', rate: 1.0821 },
  ],
  commodities: [
    { label: 'GOLD', price: 2342 },
  ],
}

const FALLBACK_MACRO: MacroData = {
  data: [
    { label: 'FED RATE',        value: 5.50, unit: '%'   },
    { label: 'BOE RATE',        value: 5.25, unit: '%'   },
    { label: 'ECB RATE',        value: 4.00, unit: '%'   },
    { label: 'US CPI',          value: 3.4,  unit: 'YOY' },
    { label: 'UK CPI',          value: 3.2,  unit: 'YOY' },
    { label: 'US UNEMPLOYMENT', value: 3.9,  unit: '%'   },
    { label: 'UK UNEMPLOYMENT', value: 4.2,  unit: '%'   },
  ],
}

// ── Display item type ───────────────────────────────────────────────────────

interface DisplayItem {
  text: string
  changeSuffix?: string
  positive?: boolean
}

function buildDisplayItems(markets: MarketsData, macro: MacroData): DisplayItem[] {
  const items: DisplayItem[] = []

  // Market indices — "S&P 500  5,234  ▲ 0.42%"
  for (const idx of markets.indices) {
    const arrow = idx.changePercent >= 0 ? '▲' : '▼'
    const pct   = Math.abs(idx.changePercent).toFixed(2)
    items.push({
      text:         `${idx.label}  ${Math.round(idx.price).toLocaleString('en-GB')}`,
      changeSuffix: `  ${arrow} ${pct}%`,
      positive:     idx.changePercent >= 0,
    })
  }

  // Forex rates — "GBP/USD  1.2634"
  for (const fx of markets.forex) {
    items.push({ text: `${fx.pair}  ${fx.rate.toFixed(4)}` })
  }

  // Commodities — "GOLD  2,342"
  for (const c of markets.commodities) {
    items.push({ text: `${c.label}  ${Math.round(c.price).toLocaleString('en-GB')}` })
  }

  // Macro indicators — "FED RATE  5.25%" or "US CPI  3.4% YOY"
  for (const m of macro.data) {
    const val = m.unit === 'YOY'
      ? `${m.value.toFixed(1)}% YOY`
      : `${m.value.toFixed(2)}%`
    items.push({ text: `${m.label}  ${val}` })
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
  return (
    <span className="flex items-center shrink-0">
      <span
        className="whitespace-nowrap text-[var(--fg)]"
        style={{ fontSize: '12px', letterSpacing: '0.02em' }}
      >
        {item.text}
        {item.changeSuffix && (
          <span style={{ color: item.positive ? 'var(--ticker-pos)' : 'var(--ticker-neg)' }}>
            {item.changeSuffix}
          </span>
        )}
      </span>
      <Separator />
    </span>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function EconomicTicker() {
  const [markets, setMarkets]         = useState<MarketsData>(FALLBACK_MARKETS)
  const [macro,   setMacro  ]         = useState<MacroData>(FALLBACK_MACRO)
  const [paused,  setPaused ]         = useState(false)
  const [prefersReduced, setPrefersReduced] = useState(false)

  // Detect prefers-reduced-motion without Framer Motion
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
      if (mktResult.status === 'fulfilled' && mktResult.value.ok) {
        try { setMarkets(await mktResult.value.json()) } catch { /* keep fallback */ }
      }
      if (macResult.status === 'fulfilled' && macResult.value.ok) {
        try { setMacro(await macResult.value.json()) } catch { /* keep fallback */ }
      }
    }
    fetchAll()
    const id = setInterval(fetchAll, 6 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const items = buildDisplayItems(markets, macro)

  // Shared wrapper styles — reserves height to prevent layout shift
  const wrapperStyle: React.CSSProperties = {
    background:   'var(--bg-subtle)',
    height:       '30px',
    display:      'flex',
    alignItems:   'center',
    width:        '100%',
    overflow:     'hidden',
    borderBottom: '1px solid var(--border)',
  }

  // Left-pinned "MARKETS" label
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

  // ── Reduced-motion variant: static, overflow-scrollable ─────────────────
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
            {items.map((item, i) => <Item key={i} item={item} />)}
          </div>
        </div>
      </div>
    )
  }

  // ── Animated scrolling ticker ────────────────────────────────────────────
  // translateX goes 0 → -50% because we render items twice; when the first
  // copy scrolls off-left the second copy fills its place seamlessly.
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
          {/* Copy 1 — primary, readable by screen readers */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {items.map((item, i) => <Item key={i} item={item} />)}
          </div>
          {/* Copy 2 — seamless loop duplicate, hidden from assistive tech */}
          <div style={{ display: 'flex', alignItems: 'center' }} aria-hidden>
            {items.map((item, i) => <Item key={`d${i}`} item={item} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
