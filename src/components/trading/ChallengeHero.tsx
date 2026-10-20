import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { MarketChart } from '@/components/trading/MarketChart'
import {
  TRADING_CHALLENGE as TC,
  TOTAL_PRIZE_POOL_GBP,
  formatChallengeDate,
  type ChallengePhase,
} from '@/lib/tradingChallenge'

const usd = (n: number) => `$${n.toLocaleString('en-GB')}`

export function statusLine(phase: ChallengePhase, resultsPublished: boolean) {
  if (phase === 'upcoming') {
    return { tone: 'open', label: 'Registration open', detail: `Trading opens ${formatChallengeDate(TC.startDate, { withYear: false, weekday: true })}` }
  }
  if (phase === 'live') {
    return { tone: 'live', label: 'In progress', detail: `Late entries welcome until ${formatChallengeDate(TC.endDate, { withYear: false })}` }
  }
  return resultsPublished
    ? { tone: 'closed', label: 'Results announced', detail: `Trading closed ${formatChallengeDate(TC.endDate)}` }
    : { tone: 'closed', label: 'Trading closed', detail: 'Results are being verified' }
}

export function ChallengeHero({
  phase,
  progress,
  daysToStart,
  resultsPublished,
}: {
  phase: ChallengePhase
  progress: number
  daysToStart: number
  resultsPublished: boolean
}) {
  const status = statusLine(phase, resultsPublished)
  const open = phase !== 'closed'

  const facts = [
    { term: 'Starting capital', value: usd(TC.startingCapitalUsd), note: 'virtual' },
    { term: 'Prize pool', value: `£${TOTAL_PRIZE_POOL_GBP}`, note: TC.prizes.map((p) => `£${p.amountGbp}`).join(' · ') },
    { term: 'Trading window', value: `${formatChallengeDate(TC.startDate, { withYear: false })} – ${formatChallengeDate(TC.endDate)}`, note: null },
    { term: 'Who can enter', value: 'Paid EconSoc members', note: null },
    { term: 'Real money at stake', value: 'None', note: 'simulated trading' },
  ]

  return (
    // On wide screens the hero fills the first screen (capped on very tall ones), which
    // centres the chart a little lower and gives its scroll-driven growth more room.
    <section aria-labelledby="challenge-title" className="trading-hero relative overflow-hidden border-b-2 border-gold bg-navy text-cream lg:flex lg:min-h-[min(calc(100svh-66px-3rem),52rem)] lg:flex-col">
      {/* Fine ruled paper: the site's dotted texture, reworked as a ledger grid. */}
      <div aria-hidden className="trading-hero-grid pointer-events-none absolute inset-0" />

      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 gap-12 px-4 pb-14 pt-12 sm:px-6 sm:pt-16 lg:flex-1 lg:grid-cols-12 lg:items-center lg:gap-10 lg:px-8 lg:pb-16 lg:pt-16">
        <div className="min-w-0 lg:col-span-6">
          <AnimateIn variant="fade-up" duration={0.6}>
            <h1
              id="challenge-title"
              className="text-balance text-[2.6rem] font-bold leading-[1.04] tracking-[-0.02em] text-cream sm:text-6xl lg:text-[4.25rem]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Think you can <span className="text-gold">beat the market?</span>
            </h1>
          </AnimateIn>

          <AnimateIn variant="fade-up" delay={0.08} duration={0.6}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-cream/80">
              Build a virtual investment portfolio. Compete against fellow EconSoc members. Prove your
              strategy and battle for the top of the leaderboard in{' '}
              {/* Keep the season (2026–27) on one line; the rest of the name may wrap. */}
              <span className="text-cream">{TC.name.replace(/ (\S+)$/, '')} <span className="whitespace-nowrap">{TC.name.split(' ').at(-1)}.</span></span>
            </p>
          </AnimateIn>

          <AnimateIn variant="fade-up" delay={0.14} duration={0.6}>
            <p className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="trading-status inline-flex items-center gap-2 font-semibold uppercase tracking-[0.18em] text-gold" data-tone={status.tone}>
                <span className="trading-status-dot" aria-hidden />
                {status.label}
              </span>
              <span className="text-cream/70">{status.detail}</span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {open ? (
                <a
                  href="#register"
                  className="btn-lift trading-cta group inline-flex min-h-12 items-center gap-2 bg-gold px-6 text-sm font-bold uppercase tracking-[0.16em] text-navy hover:bg-gold-light"
                >
                  Enter the Challenge
                  <ArrowRight size={16} aria-hidden className="transition-transform duration-200 group-hover:translate-x-1" />
                </a>
              ) : (
                <a
                  href="#standings"
                  className="btn-lift trading-cta group inline-flex min-h-12 items-center gap-2 bg-gold px-6 text-sm font-bold uppercase tracking-[0.16em] text-navy hover:bg-gold-light"
                >
                  {resultsPublished ? 'See the winners' : 'Standings and results'}
                  <ArrowRight size={16} aria-hidden className="transition-transform duration-200 group-hover:translate-x-1" />
                </a>
              )}
              <a
                href="#how-it-works"
                className="btn-press inline-flex min-h-12 items-center border border-gold/60 px-6 text-sm font-bold uppercase tracking-[0.16em] text-gold transition-colors hover:border-gold hover:bg-gold/10"
              >
                How it works
              </a>
            </div>

            {open && (
              <p className="mt-5 text-sm text-cream/65">
                Already verified?{' '}
                <a href={TC.links.game} target="_blank" rel="noopener noreferrer" className="link-underline inline-flex items-center gap-1 font-semibold text-cream hover:text-gold">
                  Go to the game on MarketWatch
                  <ArrowUpRight size={14} aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </p>
            )}
          </AnimateIn>
        </div>

        <div className="relative min-w-0 lg:col-span-6 lg:pl-4 xl:pl-10">
          {/* A low gold light behind the terminal: depth without moving anything. */}
          <div aria-hidden className="trading-chart-light pointer-events-none absolute -inset-x-8 -inset-y-10" />
          <AnimateIn variant="scale-in" delay={0.12} duration={0.8} className="relative">
            <MarketChart phase={phase} progress={progress} daysToStart={daysToStart} />
          </AnimateIn>
        </div>
      </div>

      {/* Quote board: the competition's terms at a glance. */}
      <div className="relative border-t border-gold/25 bg-navy-dark/60">
        <dl className="mx-auto grid max-w-7xl grid-cols-2 px-4 sm:px-6 md:grid-cols-3 lg:grid-cols-5 lg:px-8">
          {facts.map((f, i) => (
            <div
              key={f.term}
              className={`trading-fact consilium-reveal py-5 pr-4 ${i > 0 ? 'lg:border-l lg:border-gold/20 lg:pl-6' : ''} ${i === 4 ? 'col-span-2 md:col-span-1' : ''}`}
              data-reveal="fade-up"
              // The quote board settles in after the headline, left to right.
              style={{ '--reveal-delay': `${0.3 + i * 0.06}s`, '--reveal-duration': '0.6s' } as React.CSSProperties}
            >
              <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-cream/60">{f.term}</dt>
              <dd className="mt-1.5 text-base font-semibold tabular-nums text-cream sm:text-lg" style={{ fontFamily: 'var(--font-serif)' }}>
                {f.value}
                {f.note && <span className="ml-1.5 align-middle text-xs font-normal text-cream/60" style={{ fontFamily: 'var(--font-sans)' }}>{f.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
