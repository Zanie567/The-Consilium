import { TRADING_CHALLENGE as TC, TOTAL_PRIZE_POOL_GBP, formatChallengeDate } from '@/lib/tradingChallenge'

/**
 * Competition terms (a term sheet of the configured game settings) and the
 * official rules. Settings marked 'tbc' in the config appear only as "to be
 * confirmed"; nothing unverified is stated as fact.
 */

function Tbc() {
  return (
    <span className="ml-2 inline-block border border-gold/50 px-1.5 py-0.5 align-middle text-[0.6rem] font-bold uppercase tracking-[0.16em] text-gold-dark dark:text-gold">
      To be confirmed
    </span>
  )
}

export function ChallengeRules() {
  const prizes = TC.prizes.map((p) => `£${p.amountGbp}`).join(', ')
  const rules: { title: string; body: React.ReactNode; tbc?: boolean }[] = [
    {
      title: 'Simulated trading only',
      body: (
        <>
          Every portfolio starts with ${TC.startingCapitalUsd.toLocaleString('en-GB')} of virtual money on {TC.platform}.
          No real money is invested, and no trading gain or loss is real. Simulated returns say nothing about future
          real-world investment performance. Only the prizes are real, paid by EconSoc in pounds sterling.
        </>
      ),
    },
    {
      title: 'Eligibility',
      body: (
        <>
          The Challenge is open to paid members of the University of Edinburgh Economics Society: University of Edinburgh
          students and paid non-student members. Membership is verified before the private game password is issued.
        </>
      ),
    },
    {
      title: 'Registration and the game password',
      body: (
        <>
          Register through the official form for your route. The password is sent only to verified members and must not be
          shared.
        </>
      ),
    },
    {
      title: 'One person, one account',
      body: (
        <>
          Each member may enter once, using one individual MarketWatch account. Register the MarketWatch username you trade
          under and keep it unchanged: entries are matched to registrations by that name.
        </>
      ),
    },
    {
      title: 'Dates and late entry',
      body: (
        <>
          Trading runs from {formatChallengeDate(TC.startDate)} to {formatChallengeDate(TC.endDate)}, as set in the
          MarketWatch game. Members may join after the start while the game is running; late entrants receive the same
          starting balance and have less time to trade.
        </>
      ),
    },
    {
      title: 'Rankings',
      body: (
        <>
          Standings are MarketWatch’s rankings for the game. The final standings are the rankings when the game ends.
        </>
      ),
    },
    {
      title: 'Prizes and winner verification',
      body: (
        <>
          Prizes of {prizes} (£{TOTAL_PRIZE_POOL_GBP} in total) go to the three highest-ranked eligible entries. Before
          winners are announced, the committee checks each leading entry against approved registrations and membership
          records. Winners are announced only after that check.
        </>
      ),
    },
    {
      title: 'Ineligible entries',
      body: (
        <>
          An entry without a valid paid membership or a matching registration is not eligible for a prize and may be
          removed from the game.
        </>
      ),
    },
    {
      title: 'Ties',
      body: <>How a tie for a prize position is resolved will be confirmed by the organisers.</>,
      tbc: TC.pendingDecisions.tieBreak,
    },
  ]

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
      <div className="lg:col-span-5">
        <h3 className="text-xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
          Game settings
        </h3>
        <p className="mt-2 text-sm text-[var(--fg-muted)]">As configured in the MarketWatch game.</p>
        <dl className="trading-termsheet mt-5 border-t-2 border-navy dark:border-gold/60">
          {[
            { label: 'Organiser', value: TC.organiser, status: 'confirmed' as const },
            { label: 'Platform', value: TC.platform, status: 'confirmed' as const },
            { label: 'Trading window', value: `${formatChallengeDate(TC.startDate)} – ${formatChallengeDate(TC.endDate)}`, status: 'confirmed' as const },
            ...TC.settings,
            { label: 'Prizes', value: `${prizes}`, status: 'confirmed' as const },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-6 border-b border-[var(--border-strong)] py-3">
              <dt className="text-sm text-[var(--fg-muted)]">{row.label}</dt>
              <dd className="text-right text-sm font-semibold tabular-nums text-[var(--fg)]">
                {row.status === 'tbc' ? <Tbc /> : row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="lg:col-span-7">
        <h3 className="text-xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
          Official rules
        </h3>
        <ol className="trading-rules mt-5 divide-y divide-[var(--border-strong)] border-y border-[var(--border-strong)]">
          {rules.map((r, i) => (
            <li key={r.title} className="grid grid-cols-[2.25rem_1fr] gap-x-3 py-4">
              <span className="pt-0.5 text-sm font-bold tabular-nums text-gold-dark dark:text-gold" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h4 className="font-semibold text-[var(--fg)]">
                  {r.title}
                  {r.tbc && <Tbc />}
                </h4>
                <p className="mt-1 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">{r.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
