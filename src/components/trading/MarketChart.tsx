import type { ChallengePhase } from '@/lib/tradingChallenge'

/**
 * The hero's trading-terminal illustration: candlesticks, a moving average and
 * the competition calendar.
 *
 * The price path is DECORATIVE. It is generated from a fixed seed, carries no
 * prices or percentages, and the panel says so in visible text. The one real
 * datum is the calendar: the x-axis spans the actual trading window and the
 * marker shows where today falls in it.
 *
 * Pure SVG + CSS (no charting library, no client JavaScript). On load a single
 * panel slides off the plot from left to right, so the chart appears to be drawn
 * over time. It is one compositor-friendly transform: animating each candle and
 * the line's stroke instead cost ~0.5 s of style and paint work on a throttled
 * phone. Reduced motion shows the finished chart.
 */

const W = 560
const H = 300
const PAD = { top: 32, right: 16, bottom: 34, left: 16 }
const COUNT = 28

/** Deterministic pseudo-random sequence (mulberry32), so server output never varies. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Candle { open: number; close: number; high: number; low: number }

const candles: Candle[] = (() => {
  const r = rng(2026)
  const out: Candle[] = []
  let price = 100
  for (let i = 0; i < COUNT; i++) {
    // A mild upward drift with one pullback in the middle third: a story, not data.
    const drift = i > 9 && i < 15 ? -0.9 : 0.75
    const open = price
    const close = open + drift + (r() - 0.45) * 3.2
    const high = Math.max(open, close) + r() * 1.6
    const low = Math.min(open, close) - r() * 1.6
    out.push({ open, close, high, low })
    price = close
  }
  return out
})()

const lo = Math.min(...candles.map((c) => c.low)) - 2
const hi = Math.max(...candles.map((c) => c.high)) + 2
const plotW = W - PAD.left - PAD.right
const plotH = H - PAD.top - PAD.bottom
const step = plotW / COUNT
const x = (i: number) => PAD.left + step * (i + 0.5)
const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH

const average = candles.map((_, i) => {
  const window = candles.slice(Math.max(0, i - 4), i + 1)
  return window.reduce((s, c) => s + c.close, 0) / window.length
})
const averagePath = average.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

/** Month gridlines for the real competition window (28 Oct 2026 – 25 Mar 2027). */
const MONTHS = [
  { label: 'Nov', at: 4 / 148 },
  { label: 'Dec', at: 34 / 148 },
  { label: 'Jan', at: 65 / 148 },
  { label: 'Feb', at: 96 / 148 },
  { label: 'Mar', at: 124 / 148 },
]

export function MarketChart({ phase, progress, daysToStart }: { phase: ChallengePhase; progress: number; daysToStart: number }) {
  const markerX = PAD.left + plotW * progress
  const markerLabel =
    phase === 'upcoming' ? 'Opening bell' : phase === 'live' ? 'Today' : 'Closing bell'

  return (
    <figure className="trading-terminal relative m-0 border border-gold/30 bg-navy-dark shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-3 border-b border-gold/20 px-4 py-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-cream/70">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
          EconSoc · Virtual Stock Exchange
        </span>
        <span className="tabular-nums text-cream/60">28 Oct → 25 Mar</span>
      </div>

      <div className="relative overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true" focusable="false">
        {/* Horizontal grid */}
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH * f} y2={PAD.top + plotH * f} className="stroke-cream/[0.07]" strokeWidth="1" />
        ))}
        {/* Month grid + labels: the real competition calendar */}
        {MONTHS.map((m) => {
          const mx = PAD.left + plotW * m.at
          return (
            <g key={m.label}>
              <line x1={mx} x2={mx} y1={PAD.top} y2={PAD.top + plotH} className="stroke-cream/[0.07]" strokeWidth="1" strokeDasharray="2 4" />
              <text x={mx + 4} y={H - 12} className="fill-cream/55 text-[11px] font-semibold tracking-[0.12em]" style={{ fontFamily: 'var(--font-sans)' }}>
                {m.label.toUpperCase()}
              </text>
            </g>
          )
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stroke-gold/35" strokeWidth="1" />

        {/* Candles */}
        <g>
          {candles.map((c, i) => {
            const up = c.close >= c.open
            const top = y(Math.max(c.open, c.close))
            const bodyH = Math.max(1.5, Math.abs(y(c.open) - y(c.close)))
            return (
              <g key={i}>
                <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} className={up ? 'stroke-gold/80' : 'stroke-cream/40'} strokeWidth="1" />
                <rect
                  x={x(i) - step * 0.28}
                  y={top}
                  width={step * 0.56}
                  height={bodyH}
                  className={up ? 'fill-gold stroke-gold' : 'fill-navy-dark stroke-cream/50'}
                  strokeWidth="1"
                />
              </g>
            )
          })}
        </g>

        {/* Moving average */}
        <path d={averagePath} className="fill-none stroke-cream/80" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Today / opening / closing marker on the real calendar */}
        <g>
          <line x1={markerX} x2={markerX} y1={PAD.top - 6} y2={PAD.top + plotH} className="stroke-gold" strokeWidth="1" strokeDasharray="3 3" />
          <rect x={Math.min(markerX + 4, W - PAD.right - 92)} y={PAD.top - 12} width="88" height="18" className="fill-gold" />
          <text x={Math.min(markerX + 4, W - PAD.right - 92) + 44} y={PAD.top + 1} textAnchor="middle" className="fill-navy text-[10px] font-bold tracking-[0.14em]" style={{ fontFamily: 'var(--font-sans)' }}>
            {markerLabel.toUpperCase()}
          </text>
        </g>
      </svg>
      <div aria-hidden className="trading-wipe absolute inset-0 bg-navy-dark" />
      </div>

      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-gold/20 px-4 py-2.5 text-[0.7rem] text-cream/65">
        <span>Illustrative chart. Not market data or competition results.</span>
        {phase === 'upcoming' && daysToStart > 0 && (
          <span className="font-semibold tabular-nums text-gold">
            {daysToStart === 1 ? 'Trading opens tomorrow' : `${daysToStart} days to the opening bell`}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
