import { TRADING_CHALLENGE as TC, type ChallengePhase } from '@/lib/tradingChallenge'

/**
 * The hero's trading-terminal illustration: candlesticks, a moving average and
 * the competition calendar.
 *
 * The price path is DECORATIVE. It is generated from a fixed seed, carries no
 * prices or percentages, and the panel says so in visible text. The one real
 * datum is the calendar: the x-axis spans the actual trading window and the
 * marker shows where today falls in it.
 *
 * Pure SVG + CSS: no charting library and no client JavaScript. The chart draws
 * itself in two parts (globals.css, "Chart reveal"):
 *   1. on load, the first stretch of the trend is drawn;
 *   2. as the reader scrolls through the hero, the rest grows in, tied to scroll
 *      position (CSS scroll-driven animations). Browsers without them draw the
 *      whole chart on load instead.
 * The reveal is a clip that slides across the plot while its contents slide the
 * other way, so they stay put. Both are transforms, which the compositor runs off
 * the main thread: nothing in the SVG is re-laid-out or repainted per frame. A
 * second, narrow clip rides the same edge over a glowing copy of the line, so the
 * leading point of the trend lights up wherever the line is. Reduced motion, and
 * any browser that skips the animations, shows the finished chart.
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
const baseline = PAD.top + plotH
const areaPath = `${averagePath} L${x(COUNT - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`

/** Month gridlines for the real competition window, derived from the configured dates. */
const MONTHS = (() => {
  const start = Date.parse(`${TC.startDate}T00:00:00Z`)
  const end = Date.parse(`${TC.endDate}T00:00:00Z`)
  const months: { label: string; at: number }[] = []
  const d = new Date(start)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  for (; d.getTime() < end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push({
      label: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3),
      at: (d.getTime() - start) / (end - start),
    })
  }
  return months
})()

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const WINDOW_LABEL = `${shortDate(TC.startDate)} → ${shortDate(TC.endDate)}`

export function MarketChart({ phase, progress, daysToStart }: { phase: ChallengePhase; progress: number; daysToStart: number }) {
  const markerX = PAD.left + plotW * progress
  const markerLabel =
    phase === 'upcoming' ? 'Opening bell' : phase === 'live' ? 'Today' : 'Closing bell'

  return (
    <figure className="trading-terminal relative m-0 border border-gold/30 bg-navy-dark shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-3 border-b border-gold/20 px-4 py-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-cream/70">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
          <span className="truncate">Virtual Stock Exchange</span>
        </span>
        {/* The x-axis already shows the months; on phones the range would crowd the label. */}
        <span className="hidden shrink-0 whitespace-nowrap tabular-nums text-cream/60 sm:inline">{WINDOW_LABEL}</span>
      </div>

      <div className="trading-plot relative">
        {/* Axes: the real calendar, always fully drawn. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true" focusable="false">
          {[0.2, 0.4, 0.6, 0.8].map((f) => (
            <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH * f} y2={PAD.top + plotH * f} className="stroke-cream/[0.07]" strokeWidth="1" />
          ))}
          {MONTHS.map((m) => {
            const mx = PAD.left + plotW * m.at
            return (
              <g key={m.label}>
                <line x1={mx} x2={mx} y1={PAD.top} y2={baseline} className="stroke-cream/[0.07]" strokeWidth="1" strokeDasharray="2 4" />
                <text x={mx + 4} y={H - 12} className="fill-cream/55 text-[11px] font-semibold tracking-[0.12em]" style={{ fontFamily: 'var(--font-sans)' }}>
                  {m.label.toUpperCase()}
                </text>
              </g>
            )
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={baseline} y2={baseline} className="stroke-gold/35" strokeWidth="1" />
        </svg>

        {/* The trend, revealed left to right. */}
        <div className="trading-reveal absolute inset-0 overflow-hidden" aria-hidden>
          <div className="trading-reveal-counter absolute inset-0">
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="trading-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#c9a227" stopOpacity="0.22" />
                  <stop offset="1" stopColor="#c9a227" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill="url(#trading-area)" />
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
              <path d={averagePath} className="fill-none stroke-cream/80" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
          {/* The pen: a soft leading edge the candles emerge from. */}
          <span className="trading-reveal-edge" />
        </div>

        {/* The glint: a narrow window on the same edge, over a glowing copy of the line. */}
        <div className="trading-glint absolute inset-0" aria-hidden>
          <div className="trading-glint-window">
            <div className="trading-glint-counter">
              <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" aria-hidden="true" focusable="false">
                <defs>
                  <filter id="trading-glow" x="-10%" y="-30%" width="120%" height="160%">
                    <feGaussianBlur stdDeviation="3.5" />
                  </filter>
                </defs>
                <path d={averagePath} fill="none" stroke="#e3c35a" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" filter="url(#trading-glow)" opacity="0.9" />
                <path d={averagePath} fill="none" stroke="#fbeec4" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>

        {/* Today / opening / closing marker on the real calendar, above the trend. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden="true" focusable="false">
          <line x1={markerX} x2={markerX} y1={PAD.top - 6} y2={baseline} className="stroke-gold" strokeWidth="1" strokeDasharray="3 3" />
          <rect x={Math.min(markerX + 4, W - PAD.right - 92)} y={PAD.top - 12} width="88" height="18" className="fill-gold" />
          <text x={Math.min(markerX + 4, W - PAD.right - 92) + 44} y={PAD.top + 1} textAnchor="middle" className="fill-navy text-[10px] font-bold tracking-[0.14em]" style={{ fontFamily: 'var(--font-sans)' }}>
            {markerLabel.toUpperCase()}
          </text>
        </svg>
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
