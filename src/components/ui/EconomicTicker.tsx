'use client'

/**
 * EconomicTicker - FT-style continuously scrolling bar of market and macro data.
 *
 * Data comes from two internal routes, both cached at the edge:
 *   /api/ticker/markets - delayed index, FX and gold quotes
 *   /api/ticker/macro   - latest published macroeconomic observations
 *
 * The bar renders only what those routes return. There is no placeholder data:
 * an instrument that is unavailable or stale is simply absent, so a number on
 * screen is always a real reading. Freshness is re-checked here as well as on
 * the server, so a long-lived CDN response cannot resurrect an old quote.
 *
 * Arrows: indices, FX and gold use the provider's change against the previous
 * session close; macro series compare against the preceding observation.
 */

import { useEffect, useState } from 'react'
import {
  MARKET_MAX_AGE_MS,
  isFresh,
  type MarketQuote,
} from '@/lib/marketData'
import {
  MACRO_SERIES,
  isObservationFresh,
  type MacroObservation,
} from '@/lib/macroData'

const MARKETS_REFRESH_MS = 15 * 60 * 1000

type Dir = 'up' | 'down' | 'flat'

const UP_COLOR = '#22c55e'
const DOWN_COLOR = '#ef4444'
const FLAT_COLOR = '#9ca3af'

function arrowColor(d: Dir) {
  if (d === 'up') return UP_COLOR
  if (d === 'down') return DOWN_COLOR
  return FLAT_COLOR
}

function arrowSymbol(d: Dir) {
  if (d === 'up') return '▲'
  if (d === 'down') return '▼'
  return '▶'
}

function directionOf(change: number | null | undefined): Dir {
  if (change == null || change === 0) return 'flat'
  return change > 0 ? 'up' : 'down'
}

interface DisplayItem {
  key: string
  label: string
  value: string
  direction: Dir
}

const asLevel = (value: number) => Math.round(value).toLocaleString('en-GB')

export function buildDisplayItems(
  quotes: MarketQuote[],
  observations: MacroObservation[],
  now: number = Date.now(),
): DisplayItem[] {
  const items: DisplayItem[] = []

  for (const quote of quotes) {
    if (!isFresh(quote.asOf, MARKET_MAX_AGE_MS, now)) continue
    const d = directionOf(quote.changePercent)
    const arrow = arrowSymbol(d)
    // Indices carry their day's move; FX and gold show the level and direction
    // only, as they always have.
    const value = quote.kind === 'index' && quote.changePercent != null
      ? `${asLevel(quote.value)}  ${arrow} ${Math.abs(quote.changePercent).toFixed(2)}%`
      : quote.kind === 'fx'
        ? `${quote.value.toFixed(4)}  ${arrow}`
        : `${asLevel(quote.value)}  ${arrow}`
    items.push({ key: quote.label, label: quote.label, value, direction: d })
  }

  for (const observation of observations) {
    const cadence = MACRO_SERIES.find((s) => s.label === observation.label)?.cadence
    if (cadence && !isObservationFresh(observation.observationDate, cadence, now)) continue
    const d = observation.previousValue == null
      ? 'flat'
      : directionOf(observation.value - observation.previousValue)
    const formatted = observation.unit === 'YOY'
      ? `${observation.value.toFixed(1)}% YOY`
      : `${observation.value.toFixed(2)}%`
    items.push({
      key: observation.label,
      label: observation.label,
      value: `${formatted}  ${arrowSymbol(d)}`,
      direction: d,
    })
  }

  return items
}

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

export function EconomicTicker() {
  const [quotes, setQuotes] = useState<MarketQuote[]>([])
  const [observations, setObservations] = useState<MacroObservation[]>([])
  const [paused, setPaused] = useState(false)
  const [prefersReduced, setPrefersReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Market quotes move through the day; macro observations are published at
  // most daily, so they are read once per page rather than polled.
  useEffect(() => {
    let cancelled = false

    async function loadMarkets() {
      try {
        const res = await fetch('/api/ticker/markets')
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled && Array.isArray(body?.quotes)) setQuotes(body.quotes)
      } catch { /* leave the previous values in place */ }
    }

    async function loadMacro() {
      try {
        const res = await fetch('/api/ticker/macro')
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled && Array.isArray(body?.observations)) setObservations(body.observations)
      } catch { /* leave the previous values in place */ }
    }

    loadMarkets()
    loadMacro()
    const id = setInterval(loadMarkets, MARKETS_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const items = buildDisplayItems(quotes, observations)

  const wrapperStyle: React.CSSProperties = {
    background: 'var(--bg-subtle)',
    height: '30px',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    overflow: 'hidden',
    borderBottom: '1px solid var(--border)',
  }

  const label = (
    <div
      aria-hidden
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        height: '100%',
        borderRight: '1px solid var(--border)',
        color: 'var(--fg-faint)',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      MARKETS
    </div>
  )

  if (prefersReduced) {
    return (
      <div
        role="region"
        aria-label="Economic data ticker"
        style={wrapperStyle}
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

  return (
    <div
      role="marquee"
      aria-label="Economic data ticker"
      style={wrapperStyle}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {label}
      <div style={{ flex: 1, overflow: 'hidden', height: '100%', display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            width: 'max-content',
            animation: 'consilium-ticker 60s linear infinite',
            animationPlayState: paused ? 'paused' : 'running',
            willChange: 'transform',
          }}
        >
          {/* Copy 1 - readable by screen readers */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {items.map((item) => <Item key={item.key} item={item} />)}
          </div>
          {/* Copy 2 - seamless loop duplicate */}
          <div style={{ display: 'flex', alignItems: 'center' }} aria-hidden>
            {items.map((item) => <Item key={`d-${item.key}`} item={item} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
