import type { Prize, Winner } from '@/lib/tradingChallenge'

/**
 * The prize podium: second, first, third, with first standing tallest. On phones
 * it stays a podium, scaled down; the list keeps first-to-third reading order for
 * assistive technology. The same component shows the verified winners once
 * results are published (then phones get a ranked list, because names are long).
 *
 * Entrance (globals.css, "Prize podium"): the columns rise into place in podium
 * order (second, first, third), then the medals are presented. It is a CSS
 * animation on the list, so it needs no script; RevealOnScroll holds it until the
 * podium scrolls into view, and it plays once. Reduced motion shows it finished.
 */

const PLACE = {
  1: { word: 'First', ordinal: '1st', metal: 'gold' },
  2: { word: 'Second', ordinal: '2nd', metal: 'silver' },
  3: { word: 'Third', ordinal: '3rd', metal: 'bronze' },
} as const

/** Light, mid and deep tones per metal: the rim gradient, face and engraving. */
const METAL = {
  gold: { light: '#f7e08f', mid: '#d4ad35', deep: '#8a6a12', ink: '#6b5009', stripe: '#c9a227' },
  silver: { light: '#f7f8fa', mid: '#b4bcc8', deep: '#646e7c', ink: '#46505d', stripe: '#c3cad4' },
  bronze: { light: '#f3c9a0', mid: '#c08655', deep: '#7a4a22', ink: '#5c3515', stripe: '#c08655' },
} as const

/** Laurel leaves along the lower arc of the medal face, one branch per side. */
const LAUREL = [-1, 1].flatMap((side) =>
  [0, 1, 2, 3, 4].map((k) => {
    // 90° points straight down; each branch climbs from the bottom of the face.
    const deg = 90 + side * (26 + k * 21)
    const a = (deg * Math.PI) / 180
    const cx = 40 + 17.2 * Math.cos(a)
    const cy = 66 + 17.2 * Math.sin(a)
    // A leaf's long axis follows the arc (rotate by the angle itself), leaning a
    // little inward so each branch reads as climbing towards the top of the face.
    return { cx, cy, rot: deg - side * 22, key: `${side}-${k}` }
  }),
)

/** The two stems the leaves grow from. */
const STEMS = [-1, 1].map((side) => {
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${(40 + 15.6 * Math.cos(a)).toFixed(2)},${(66 + 15.6 * Math.sin(a)).toFixed(2)}`
  }
  const from = 90 + side * 14
  const to = 90 + side * 112
  // Sweep flag: the left branch runs clockwise from the bottom, the right anticlockwise.
  return `M${at(from)} A15.6 15.6 0 0 ${side === 1 ? 1 : 0} ${at(to)}`
})

/**
 * A struck medal on a ribbon: navy straps with a metal stripe (the house colours),
 * a clasp, a milled rim, a bevelled face with a laurel and the place numeral.
 */
export function Medal({ place, idPrefix, className = '' }: { place: 1 | 2 | 3; idPrefix: string; className?: string }) {
  const metal = PLACE[place].metal
  const m = METAL[metal]
  const id = (part: string) => `${idPrefix}-medal-${place}-${part}`
  return (
    <span className={`trading-medal relative inline-block shrink-0 ${className}`} data-metal={metal}>
      <svg viewBox="0 0 80 104" className="block h-full w-full overflow-visible" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id('rim')} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
            <stop offset="0" stopColor={m.light} />
            <stop offset="0.45" stopColor={m.mid} />
            <stop offset="1" stopColor={m.deep} />
          </linearGradient>
          <radialGradient id={id('face')} cx="0.36" cy="0.3" r="0.8">
            <stop offset="0" stopColor={m.light} />
            <stop offset="0.55" stopColor={m.mid} />
            <stop offset="1" stopColor={m.deep} stopOpacity="0.9" />
          </radialGradient>
          <clipPath id={id('disc')}>
            <circle cx="40" cy="66" r="25.6" />
          </clipPath>
        </defs>

        {/* Ribbon: the far strap first, then the near one folded over it. */}
        <g>
          <polygon points="50,0 70,0 47,47 31,43" fill="#111b33" />
          <polygon points="57.5,0 62.5,0 40.5,45.5 36.5,44.5" fill={m.stripe} opacity="0.85" />
          <polygon points="10,0 30,0 49,43 33,47" fill="#22325a" />
          <polygon points="17.5,0 22.5,0 43.5,44.5 39.5,45.5" fill={m.stripe} />
          <polygon points="10,0 30,0 49,43 33,47" fill="none" className="medal-ribbon-edge" strokeWidth="0.8" />
          <polygon points="50,0 70,0 47,47 31,43" fill="none" className="medal-ribbon-edge" strokeWidth="0.8" />
        </g>

        {/* Clasp joining ribbon and medal. */}
        <rect x="32" y="33" width="16" height="7" rx="2" fill={`url(#${id('rim')})`} stroke={m.deep} strokeWidth="0.8" />

        {/* Cast shadow, then the medal. */}
        <circle cx="41.2" cy="68.2" r="30" fill="#0b1224" opacity="0.22" />
        <circle cx="40" cy="66" r="30" fill={`url(#${id('rim')})`} />
        <circle cx="40" cy="66" r="28.4" fill="none" stroke={m.deep} strokeOpacity="0.5" strokeWidth="1.6" strokeDasharray="0.55 1.25" />
        <circle cx="40" cy="66" r="25.6" fill={`url(#${id('face')})`} stroke={m.deep} strokeOpacity="0.55" strokeWidth="0.9" />
        <circle cx="40" cy="66" r="22.6" fill="none" stroke={m.deep} strokeOpacity="0.45" strokeWidth="0.6" />
        <circle cx="40" cy="66" r="21.9" fill="none" stroke={m.light} strokeOpacity="0.75" strokeWidth="0.6" />

        <g fill="none" stroke={m.deep} strokeWidth="0.7" strokeLinecap="round" opacity="0.55">
          {STEMS.map((d) => <path key={d} d={d} />)}
        </g>
        <g fill={m.deep} opacity="0.6">
          {LAUREL.map((l) => (
            <ellipse key={l.key} cx={l.cx.toFixed(2)} cy={l.cy.toFixed(2)} rx="1.5" ry="3.3" transform={`rotate(${l.rot.toFixed(1)} ${l.cx.toFixed(2)} ${l.cy.toFixed(2)})`} />
          ))}
        </g>

        {/* The numeral, struck: a light edge under a deep fill reads as relief. */}
        <g className="medal-numeral" textAnchor="middle" style={{ fontFamily: 'var(--font-serif)' }}>
          <text x="40" y="76.4" fill={m.light} opacity="0.85">{place}</text>
          <text x="40" y="75.4" fill={m.ink}>{place}</text>
        </g>

        {/* Specular highlight across the upper face. */}
        <g clipPath={`url(#${id('disc')})`}>
          <ellipse cx="31" cy="50" rx="17" ry="7.5" fill="#fff" opacity="0.28" transform="rotate(-32 31 50)" />
        </g>
      </svg>
      {/* A one-time light sweep across the face, played by the podium entrance. */}
      <span aria-hidden className="trading-medal-sheen" />
    </span>
  )
}

export function PrizePodium({
  prizes,
  winners,
  headingLevel = 'h3',
  idPrefix = 'prizes',
}: {
  prizes: readonly Prize[]
  /** Verified winners, if published. Omit for the prize showcase. */
  winners?: readonly Winner[]
  headingLevel?: 'h3' | 'h4'
  /** Keeps SVG gradient ids unique when the podium appears twice on a page. */
  idPrefix?: string
}) {
  const Heading = headingLevel
  const byPlace = (p: 1 | 2 | 3) => prizes.find((x) => x.place === p)
  const winnerFor = (p: 1 | 2 | 3) => winners?.find((w) => w.place === p)

  return (
    <ol
      className="trading-podium consilium-reveal"
      data-reveal="podium"
      data-mode={winners ? 'winners' : 'prizes'}
      aria-label={winners ? 'Verified winners' : 'Prizes'}
    >
      {([1, 2, 3] as const).map((place) => {
        const prize = byPlace(place)
        const winner = winnerFor(place)
        return (
          <li key={place} className="trading-podium-place" data-place={place} data-metal={PLACE[place].metal}>
            <div className="trading-podium-card">
              <Medal place={place} idPrefix={idPrefix} className="trading-podium-medal" />
              <div className="min-w-0">
                <Heading className="trading-podium-label font-semibold uppercase text-[var(--fg-muted)]">
                  {PLACE[place].word} place
                </Heading>
                {winner ? (
                  <>
                    <p className="mt-1 break-words text-2xl font-bold leading-tight text-[var(--fg)] md:text-[1.7rem]" style={{ fontFamily: 'var(--font-serif)' }}>
                      {winner.displayName}
                    </p>
                    <p className="mt-1 text-sm text-[var(--fg-muted)]">
                      {prize && <>Wins <span className="font-semibold text-[var(--fg)]">£{prize.amountGbp}</span></>}
                      {typeof winner.finalReturnPct === 'number' && (
                        <> · Final return {winner.finalReturnPct >= 0 ? '+' : ''}{winner.finalReturnPct.toFixed(1)}%</>
                      )}
                    </p>
                  </>
                ) : (
                  prize && (
                    <p className="trading-amount font-bold leading-none tabular-nums text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                      <span className="trading-amount-symbol">£</span>
                      {prize.amountGbp}
                    </p>
                  )
                )}
              </div>
            </div>
            {/* The plinth: its height encodes the place. */}
            <div aria-hidden className="trading-plinth">
              <span className="trading-plinth-ordinal">{PLACE[place].ordinal}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
