import { Fragment } from 'react'
import { TRADING_CHALLENGE as TC, TOTAL_PRIZE_POOL_GBP, formatChallengeDate } from '@/lib/tradingChallenge'

/**
 * The competition at a glance (the essentials only: who, where, when, how much)
 * and the official rules. Detailed MarketWatch game settings are deliberately not
 * restated here; the game itself is the authority on them. Anything the
 * organisers have not yet decided is marked "to be confirmed", never stated.
 */

function Tbc() {
  return (
    <span className="ml-2 inline-block border border-gold/50 px-1.5 py-0.5 align-middle text-[0.6rem] font-bold uppercase tracking-[0.16em] text-[#8a6d14] dark:text-gold">
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
          University of Edinburgh students register through the official Google Form. Paid non-student members register
          by emailing the committee, who verify their membership by hand. The password is sent only to verified members and
          must not be shared.
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

  const glance: { term: string; detail: React.ReactNode }[] = [
    { term: 'Organiser', detail: TC.organiser },
    { term: 'Platform', detail: TC.platform },
    {
      term: 'Competition dates',
      detail: (
        <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <span className="trading-glance-sub">Starts</span>
          <span>{formatChallengeDate(TC.startDate)}</span>
          <span className="trading-glance-sub">Ends</span>
          <span>{formatChallengeDate(TC.endDate)}</span>
        </span>
      ),
    },
    {
      term: 'Starting balance',
      detail: (
        <>
          ${TC.startingCapitalUsd.toLocaleString('en-GB')} <span className="trading-glance-sub ml-1">virtual</span>
        </>
      ),
    },
    { term: 'Markets', detail: TC.markets },
    {
      term: 'Prizes',
      detail: (
        <span className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5">
          {TC.prizes.map((p) => (
            <Fragment key={p.place}>
              <span className="trading-glance-sub">{['First', 'Second', 'Third'][p.place - 1]}</span>
              <span className="trading-glance-prize" data-metal={p.place === 1 ? 'gold' : p.place === 2 ? 'silver' : 'bronze'}>
                <span className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--font-serif)' }}>£{p.amountGbp}</span>
              </span>
            </Fragment>
          ))}
        </span>
      ),
    },
  ]

  return (
    <div>
      <h3 className="text-xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
        Competition at a glance
      </h3>
      <dl className="trading-glance mt-5 grid border-t-2 border-navy sm:grid-cols-2 lg:grid-cols-3 dark:border-gold/60">
        {glance.map((g) => (
          <div key={g.term}>
            <dt className="text-sm text-[var(--fg-muted)]">{g.term}</dt>
            <dd className="mt-1.5 font-semibold leading-snug text-[var(--fg)]">{g.detail}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-16 text-xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
        Official rules
      </h3>
      <ol className="trading-rules mt-5 grid border-b border-[var(--border-strong)] lg:grid-cols-2 lg:gap-x-14">
        {rules.map((r, i) => (
          <li key={r.title} className="grid grid-cols-[2.25rem_1fr] gap-x-3 border-t border-[var(--border-strong)] py-4">
            <span className="pt-0.5 text-sm font-bold tabular-nums text-[#8a6d14] dark:text-gold" aria-hidden>
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
  )
}
