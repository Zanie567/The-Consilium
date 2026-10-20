import type { Prize, Winner } from '@/lib/tradingChallenge'

/**
 * The prize podium. Second, first, third on wide screens (first stands tallest);
 * a ranked list on phones, first at the top. The same component shows the
 * verified winners once results are published.
 */

const PLACE = {
  1: { word: 'First', ordinal: '1st', metal: 'gold' },
  2: { word: 'Second', ordinal: '2nd', metal: 'silver' },
  3: { word: 'Third', ordinal: '3rd', metal: 'bronze' },
} as const

function Medal({ place }: { place: 1 | 2 | 3 }) {
  // A struck medal: milled rim, laurel sprigs, the place numeral.
  return (
    <svg viewBox="0 0 64 64" className="trading-medal h-14 w-14 shrink-0" data-metal={PLACE[place].metal} aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" className="medal-rim" />
      <circle cx="32" cy="32" r="24.5" className="medal-face" />
      <circle cx="32" cy="32" r="21" className="medal-ring" fill="none" strokeWidth="0.75" strokeDasharray="1.2 2.2" />
      {[-1, 1].map((side) => (
        <g key={side} transform={`translate(32 32) scale(${side} 1)`} className="medal-laurel">
          {[0, 1, 2, 3].map((k) => (
            <ellipse key={k} cx={-15 + k * 1.2} cy={8 - k * 6} rx="1.8" ry="3.6" transform={`rotate(${-35 + k * 12} ${-15 + k * 1.2} ${8 - k * 6})`} />
          ))}
        </g>
      ))}
      <text x="32" y="39" textAnchor="middle" className="medal-numeral" style={{ fontFamily: 'var(--font-serif)' }}>
        {place}
      </text>
    </svg>
  )
}

export function PrizePodium({
  prizes,
  winners,
  headingLevel = 'h3',
}: {
  prizes: readonly Prize[]
  /** Verified winners, if published. Omit for the prize showcase. */
  winners?: readonly Winner[]
  headingLevel?: 'h3' | 'h4'
}) {
  const Heading = headingLevel
  const byPlace = (p: 1 | 2 | 3) => prizes.find((x) => x.place === p)
  const winnerFor = (p: 1 | 2 | 3) => winners?.find((w) => w.place === p)

  return (
    <ol className="trading-podium grid items-end gap-4 md:grid-cols-3 md:gap-5" aria-label={winners ? 'Verified winners' : 'Prizes'}>
      {([1, 2, 3] as const).map((place) => {
        const prize = byPlace(place)
        const winner = winnerFor(place)
        return (
          <li
            key={place}
            className="trading-step relative flex flex-col"
            data-place={place}
            data-metal={PLACE[place].metal}
          >
            <div className="trading-step-card flex items-center gap-4 border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 py-5 md:flex-col md:items-start md:gap-5 md:px-6 md:py-6">
              <Medal place={place} />
              <div className="min-w-0">
                <Heading className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fg-muted)]">
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
                    <p className="trading-amount mt-1 font-bold leading-none tabular-nums text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                      £{prize.amountGbp}
                    </p>
                  )
                )}
              </div>
            </div>
            {/* The plinth: height encodes the place on wide screens only. */}
            <div aria-hidden className="trading-plinth hidden md:flex items-start justify-center bg-navy pt-3 text-[0.65rem] font-bold uppercase tracking-[0.3em] text-cream/60">
              {PLACE[place].ordinal}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
