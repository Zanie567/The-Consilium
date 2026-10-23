import type { Metadata } from 'next'
import { ArrowRight, ArrowUpRight, Mail } from 'lucide-react'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { ChallengeHero } from '@/components/trading/ChallengeHero'
import { PrizePodium } from '@/components/trading/PrizePodium'
import { RegistrationPanel } from '@/components/trading/RegistrationPanel'
import { ChallengeRules } from '@/components/trading/ChallengeRules'
import { ChallengeFaq } from '@/components/trading/ChallengeFaq'
import { canonicalAlternates, pageOpenGraph, pageTwitter } from '@/lib/seo'
import {
  TRADING_CHALLENGE as TC,
  TOTAL_PRIZE_POOL_GBP,
  challengePhase,
  daysUntil,
  formatChallengeDate,
  googleFormEmbedUrl,
  nonStudentMailto,
  publishedWinners,
  windowProgress,
} from '@/lib/tradingChallenge'

const TITLE = 'EconSoc Trading Challenge 2026–27'
/** The campaign's own share card; it replaces the site default on this page only. */
const SHARE_IMAGE = { url: '/og/trading-challenge.png', width: 1200, height: 630, type: 'image/png', alt: 'The EconSoc Trading Challenge 2026–27: think you can beat the market?' }
const DESCRIPTION =
  'Build a virtual portfolio with $100,000 of simulated capital and compete with fellow EconSoc members for £175 in prizes. Trading runs 28 October 2026 to 25 March 2027 on MarketWatch.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: canonicalAlternates('/trading-challenge'),
  openGraph: pageOpenGraph('/trading-challenge', {
    title: `${TITLE} | The Consilium`,
    description: DESCRIPTION,
    image: SHARE_IMAGE,
  }),
  twitter: pageTwitter({ title: TITLE, description: DESCRIPTION, images: [SHARE_IMAGE] }),
}

// No database, no cookies: the page is static and re-rendered hourly so the
// competition phase (computed from the London date) moves on by itself. The phase
// is computed here on the server and passed down, so the browser never re-derives
// it and hydration cannot disagree near midnight.
export const revalidate = 3600

const usd = (n: number) => `$${n.toLocaleString('en-GB')}`

const sectionTitle = 'text-balance text-3xl font-bold leading-tight tracking-[-0.01em] text-[var(--fg)] sm:text-4xl'

export default function TradingChallengePage() {
  const now = new Date()
  const phase = challengePhase(now)
  const winners = publishedWinners()
  const resultsPublished = winners.length > 0
  const open = phase !== 'closed'

  const student = { responderUrl: TC.registration.student.responderUrl, embedUrl: googleFormEmbedUrl(TC.registration.student.responderUrl) }

  const steps = [
    {
      title: 'Create a free MarketWatch account',
      body: 'The Challenge runs on MarketWatch’s Virtual Stock Exchange. Sign up if you don’t already have an account, and note the username you’ll trade under.',
      action: { href: TC.links.marketwatch, label: 'Go to MarketWatch', external: true },
    },
    {
      title: 'Become a paid EconSoc member',
      body: 'Entry is open to paid members of the Economics Society. Buy membership through EUSA if you haven’t already.',
      action: { href: TC.links.membership, label: 'Buy EconSoc membership', external: true },
    },
    {
      title: 'Register for the Challenge',
      body: 'Register so we can verify your membership. Students complete a short form with their student number; non-student members email the committee.',
      action: open ? { href: '#register', label: 'Register below', external: false } : null,
    },
    {
      title: 'Get your login and start trading',
      body: `Once you’re verified, we email you the private game link and password. Join the game on MarketWatch and trade from ${formatChallengeDate(TC.startDate, { withYear: false })}.`,
      action: null,
    },
  ]

  return (
    <div className="trading-page bg-[var(--bg)]">
      <ChallengeHero phase={phase} progress={windowProgress(now)} daysToStart={daysUntil(now, TC.startDate)} resultsPublished={resultsPublished} />

      {/* ── Prizes ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="prizes-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <AnimateIn className="lg:col-span-5">
            <h2 id="prizes-title" className={sectionTitle} style={{ fontFamily: 'var(--font-serif)' }}>
              £{TOTAL_PRIZE_POOL_GBP} for the top three portfolios
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-[var(--fg-muted)]">
              Prizes go to the three highest-ranked eligible entries when trading closes on{' '}
              {formatChallengeDate(TC.endDate)}, after the committee has verified each winner’s membership and registration.
            </p>
          </AnimateIn>
          {/* The podium choreographs its own entrance (PrizePodium). */}
          <div className="lg:col-span-7">
            <PrizePodium prizes={TC.prizes} />
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-y border-[var(--border)] bg-[var(--bg-subtle)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimateIn>
            <h2 id="how-title" className={sectionTitle} style={{ fontFamily: 'var(--font-serif)' }}>
              How to enter
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-[var(--fg-muted)]">
              Four steps, two of them sign-ups. Your MarketWatch account is where you trade; registering with EconSoc is how
              we confirm your membership and send you the private game password. You need both.
            </p>
          </AnimateIn>

          {/* The ruled line joining the steps draws in as they arrive (wide screens). */}
          <ol className="trading-steps consilium-reveal mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-8" data-reveal="steps">
            {steps.map((s, i) => (
              <li
                key={s.title}
                className="consilium-reveal trading-step-item relative flex h-full flex-col"
                data-reveal="fade-up"
                style={{ '--reveal-delay': `${0.1 + i * 0.09}s`, '--reveal-duration': '0.6s' } as React.CSSProperties}
              >
                  <span className="trading-step-node flex h-10 w-10 items-center justify-center border border-gold bg-[var(--bg)] text-sm font-bold tabular-nums text-[#8a6d14] dark:text-gold" aria-hidden>
                    {i + 1}
                  </span>
                  <h3 className="mt-5 text-lg font-bold leading-snug text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.title}
                  </h3>
                  <p className="mt-2 flex-1 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">{s.body}</p>
                  {s.action && (
                    <a
                      href={s.action.href}
                      {...(s.action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="mt-4 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold"
                    >
                      {s.action.label}
                      {s.action.external && (
                        <>
                          <ArrowUpRight size={14} aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </>
                      )}
                    </a>
                  )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Registration ───────────────────────────────────────────────── */}
      <section id="register" aria-labelledby="register-title" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <AnimateIn>
          <h2 id="register-title" className={sectionTitle} style={{ fontFamily: 'var(--font-serif)' }}>
            {open ? 'Register for the Challenge' : 'Registration has closed'}
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--fg-muted)]">
            {open
              ? 'Registration is how EconSoc verifies your membership. The Google Form below is the official record of your entry: its own confirmation message tells you it has been received.'
              : `Trading ended on ${formatChallengeDate(TC.endDate)}, so the Challenge is no longer accepting entries. Thank you to everyone who took part.`}
          </p>
        </AnimateIn>

        {open ? (
          <AnimateIn className="mt-10" delay={0.08} duration={0.6}>
            <RegistrationPanel
              student={student}
              nonStudentMailto={nonStudentMailto()}
              supportEmail={TC.supportEmail}
              membershipUrl={TC.links.membership}
              lateEntry={phase === 'live'}
            />
          </AnimateIn>
        ) : (
          <p className="mt-6 text-[var(--fg-muted)]">
            Questions about your entry? Email{' '}
            <a href={`mailto:${TC.supportEmail}`} className="font-semibold text-[var(--fg)] underline decoration-gold underline-offset-4">
              {TC.supportEmail}
            </a>
            .
          </p>
        )}
      </section>

      {/* ── Standings and results ──────────────────────────────────────── */}
      <section id="standings" aria-labelledby="standings-title" className="trading-deferred scroll-mt-20 bg-navy text-cream">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:gap-14 lg:px-8 lg:py-24">
          <AnimateIn className="lg:col-span-5">
            <h2 id="standings-title" className="text-balance text-3xl font-bold leading-tight text-cream sm:text-4xl" style={{ fontFamily: 'var(--font-serif)' }}>
              {resultsPublished ? 'The winners' : 'Standings'}
            </h2>
            <p className="mt-4 leading-relaxed text-cream/75">
              Live rankings are kept by MarketWatch and are visible to players inside the game. The Consilium does not
              mirror the leaderboard: a prize position counts only once the committee has verified it.
            </p>
            <a
              href={TC.links.rankings}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-7 inline-flex min-h-12 items-center gap-2 border border-gold/60 px-5 text-sm font-bold uppercase tracking-[0.14em] text-gold hover:border-gold hover:bg-gold/10"
            >
              {phase === 'closed' ? 'Final rankings on MarketWatch' : 'Rankings on MarketWatch'}
              <ArrowUpRight size={15} aria-hidden />
              <span className="sr-only">(opens in a new tab; sign-in required)</span>
            </a>
            <p className="mt-3 text-xs text-cream/60">Sign in to MarketWatch and join the game to see them.</p>
          </AnimateIn>

          <AnimateIn className="lg:col-span-7" delay={0.08}>
            {resultsPublished ? (
              <div className="trading-results">
                <PrizePodium prizes={TC.prizes} winners={winners} idPrefix="winners" />
              </div>
            ) : (
              <div className="trading-awaiting border border-dashed border-gold/35 px-6 py-10 sm:px-10">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                  {phase === 'closed' ? 'Results being verified' : 'Winners announced after the close'}
                </p>
                <p className="mt-3 text-2xl font-bold leading-snug text-cream" style={{ fontFamily: 'var(--font-serif)' }}>
                  {phase === 'closed'
                    ? 'Trading has ended. The committee is checking the leading entries before announcing the winners here.'
                    : `The verified top three will be announced here after trading closes on ${formatChallengeDate(TC.endDate)}.`}
                </p>
                <ol className="mt-8 grid grid-cols-3 gap-3" aria-label="Prize places awaiting results">
                  {TC.prizes.map((p) => (
                    <li key={p.place} className="border-t-2 pt-3 text-sm text-cream/70" data-metal={p.place === 1 ? 'gold' : p.place === 2 ? 'silver' : 'bronze'}>
                      <span className="block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-cream/60">{['1st', '2nd', '3rd'][p.place - 1]}</span>
                      <span className="mt-1 block font-semibold tabular-nums text-cream">£{p.amountGbp}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </AnimateIn>
        </div>
      </section>

      {/* ── Rules ──────────────────────────────────────────────────────── */}
      <section id="rules" aria-labelledby="rules-title" className="trading-deferred scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <AnimateIn>
          <h2 id="rules-title" className={sectionTitle} style={{ fontFamily: 'var(--font-serif)' }}>
            The rules
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--fg-muted)]">
            The Challenge is a simulation for learning and friendly competition. Nothing on this page is investment advice.
          </p>
        </AnimateIn>
        <div className="mt-12">
          <ChallengeRules />
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section id="faq" aria-labelledby="faq-title" className="trading-deferred scroll-mt-20 border-t border-[var(--border)] bg-[var(--bg-subtle)]">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:gap-14 lg:px-8 lg:py-24">
          <div className="lg:col-span-4">
            <AnimateIn className="lg:sticky lg:top-28">
              <h2 id="faq-title" className={sectionTitle} style={{ fontFamily: 'var(--font-serif)' }}>
                Questions
              </h2>
              <p className="mt-4 leading-relaxed text-[var(--fg-muted)]">
                Can’t find an answer? Email EconSoc and include your name and MarketWatch username.
              </p>
              <a
                href={`mailto:${TC.supportEmail}`}
                className="mt-5 inline-flex min-h-11 items-center gap-2 break-all font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold"
              >
                <Mail size={16} aria-hidden className="shrink-0" />
                {TC.supportEmail}
              </a>
            </AnimateIn>
          </div>
          <AnimateIn className="lg:col-span-8" delay={0.08}>
            <ChallengeFaq />
          </AnimateIn>
        </div>
      </section>

      {/* ── Closing call to action ─────────────────────────────────────── */}
      {open && (
        <section aria-labelledby="closing-title" className="trading-closing relative overflow-hidden border-t-2 border-gold bg-navy text-cream">
          <div aria-hidden className="trading-hero-grid pointer-events-none absolute inset-0" />
          <AnimateIn className="relative mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-20">
            <div className="max-w-2xl">
              <h2 id="closing-title" className="text-balance text-3xl font-bold leading-tight text-cream sm:text-4xl" style={{ fontFamily: 'var(--font-serif)' }}>
                {phase === 'live' ? 'There’s still time to take your seat at the table.' : 'Take your seat at the opening bell.'}
              </h2>
              <p className="mt-4 leading-relaxed text-cream/75">
                {usd(TC.startingCapitalUsd)} of virtual capital, nearly five months of trading and{' '}
                <span className="whitespace-nowrap font-semibold text-gold">£{TC.prizes[0].amountGbp} · £{TC.prizes[1].amountGbp} · £{TC.prizes[2].amountGbp}</span>{' '}
                for the top three. {phase === 'live' ? `Late entries are open until ${formatChallengeDate(TC.endDate)}.` : `Trading opens ${formatChallengeDate(TC.startDate, { withYear: false })}.`}
              </p>
            </div>
            <a
              href="#register"
              className="btn-lift trading-cta group inline-flex min-h-12 shrink-0 items-center gap-2 self-start bg-gold px-7 text-sm font-bold uppercase tracking-[0.16em] text-navy hover:bg-gold-light lg:self-auto"
            >
              Enter the Challenge
              <ArrowRight size={16} aria-hidden className="transition-transform duration-200 group-hover:translate-x-1" />
            </a>
          </AnimateIn>
        </section>
      )}

      <p className="mx-auto max-w-6xl px-4 py-8 text-xs leading-relaxed text-[var(--fg-muted)] sm:px-6 lg:px-8">
        {TC.name} is organised by the {TC.organiser} and hosted on MarketWatch’s Virtual Stock Exchange. MarketWatch is not
        affiliated with EconSoc or The Consilium. All trading is simulated.
      </p>
    </div>
  )
}
