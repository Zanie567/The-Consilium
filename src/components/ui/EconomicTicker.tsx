'use client'

/**
 * EconomicTicker — continuously scrolling gold bar showing live economic data.
 *
 * Data sources (via internal API routes, cached server-side):
 *   /api/ticker/markets — Alpha Vantage: indices, forex, gold
 *   /api/ticker/macro   — FRED: CPI, unemployment, central bank rates
 *
 * Behaviour:
 *   - Falls back to hardcoded data until real data loads (never blank)
 *   - Pauses on hover
 *   - prefers-reduced-motion: shows a static bar instead of scrolling
 *   - Hidden on /editorial, /admin, /login, /signup, /privacy, /terms
 *   - Client-side refresh every 6 hours (server routes are also ISR-cached)
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useReducedMotion } from 'framer-motion'

// ── Route exclusions ────────────────────────────────────────────────────────

const HIDDEN_PREFIXES = [
  '/editorial',
  '/admin',
  '/login',
  '/signup',
  '/register',
  '/privacy',
  '/terms',
]

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
// Shown immediately on first render and whenever both APIs are unavailable.

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
    { pair: 'USD/CNY', rate: 7.2312 },
    { pair: 'USD/INR', rate: 83.45  },
  ],
  commodities: [
    { label: 'GOLD', price: 2342 },
  ],
}

const FALLBACK_MACRO: MacroData = {
  data: [
    { label: 'BANK OF ENGLAND', value: 5.25, unit: '%'  },
    { label: 'FEDERAL RESERVE', value: 5.50, unit: '%'  },
    { label: 'ECB RATE',        value: 4.00, unit: '%'  },
    { label: 'UK CPI',          value: 3.2,  unit: 'YOY' },
    { label: 'US CPI',          value: 3.4,  unit: 'YOY' },
    { label: 'US UNEMPLOYMENT', value: 3.9,  unit: '%'  },
    { label: 'UK UNEMPLOYMENT', value: 4.2,  unit: '%'  },
  ],
}

// ── Display item type ───────────────────────────────────────────────────────

interface DisplayItem {
  /** e.g. "S&P 500: 5,234" or "GBP/USD: 1.2634" */
  prefix: string
  /** e.g. " ▲ +0.3%" — rendered in a coloured span */
  changeSuffix?: string
  /** true = positive (green), false = negative (red) */
  positive?: boolean
}

function buildDisplayItems(markets: MarketsData, macro: MacroData): DisplayItem[] {
  const items: DisplayItem[] = []

  // Indices with directional arrows
  for (const idx of markets.indices) {
    const arrow = idx.changePercent >= 0 ? '▲' : '▼'
    const sign  = idx.changePercent >= 0 ? '+' : ''
    items.push({
      prefix:       `${idx.label}: ${Math.round(idx.price).toLocaleString()}`,
      changeSuffix: ` ${arrow} ${sign}${Math.abs(idx.changePercent).toFixed(1)}%`,
      positive:     idx.changePercent >= 0,
    })
  }

  // Forex rates
  for (const fx of markets.forex) {
    items.push({ prefix: `${fx.pair}: ${fx.rate.toFixed(4)}` })
  }

  // Commodities (e.g. Gold)
  for (const c of markets.commodities) {
    items.push({ prefix: `${c.label}: ${Math.round(c.price).toLocaleString()}` })
  }

  // Macro indicators
  for (const m of macro.data) {
    if (m.unit === 'YOY') {
      items.push({ prefix: `${m.label}: ${m.value.toFixed(1)}% YOY` })
    } else {
      items.push({ prefix: `${m.label}: ${m.value.toFixed(2)}%` })
    }
  }

  return items
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Separator() {
  return (
    // Slightly darker gold for the diamond separator
    <span className="shrink-0 select-none px-1 text-[#a07c1a] text-[10px]" aria-hidden>
      ◆
    </span>
  )
}

function Item({ item }: { item: DisplayItem }) {
  return (
    <span className="flex items-center shrink-0">
      <span className="px-3 py-[5px] text-[11px] font-bold uppercase tracking-wider whitespace-nowrap text-[#1a2744]">
        {item.prefix}
        {item.changeSuffix && (
          <span
            // Positive = dark green, negative = dark red — both readable on gold
            className={item.positive ? 'text-[#145a32]' : 'text-[#7b1515]'}
          >
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
  const pathname          = usePathname()
  const prefersReduced    = useReducedMotion()
  const [markets, setMarkets] = useState<MarketsData>(FALLBACK_MARKETS)
  const [macro,   setMacro  ] = useState<MacroData>(FALLBACK_MACRO)
  const [paused,  setPaused ] = useState(false)

  const hidden = HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p))

  // Fetch live data on mount, then refresh every 6 hours
  useEffect(() => {
    if (hidden) return

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
  }, [hidden])

  if (hidden) return null

  const items = buildDisplayItems(markets, macro)

  // ── Reduced-motion variant: static, no animation ──────────────────────────
  if (prefersReduced) {
    return (
      <div
        className="w-full bg-[#c9a227] overflow-x-auto"
        aria-label="Economic data"
        // Hide native scrollbar — content is readable; users can scroll if they choose
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="flex items-center min-w-max">
          {items.map((item, i) => <Item key={i} item={item} />)}
        </div>
      </div>
    )
  }

  // ── Animated scrolling ticker ─────────────────────────────────────────────
  // The @keyframes consilium-ticker is defined in globals.css.
  // translateX goes from 0 → -50% because we render items twice:
  // when the first copy scrolls off-left the second copy takes its place seamlessly.
  return (
    <div
        className="w-full bg-[#c9a227] overflow-hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        aria-label="Economic data ticker — hover to pause"
      >
        <div
          className="flex w-max"
          style={{
            animation:          'consilium-ticker 48s linear infinite',
            animationPlayState: paused ? 'paused' : 'running',
            willChange:         'transform',
          }}
        >
          {/* Copy 1 — primary */}
          <div className="flex">
            {items.map((item, i) => <Item key={i} item={item} />)}
          </div>
          {/* Copy 2 — seamless loop duplicate, hidden from screen readers */}
          <div className="flex" aria-hidden>
            {items.map((item, i) => <Item key={i} item={item} />)}
          </div>
        </div>
      </div>
  )
}
