import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { GoogleFormEmbed } from '@/components/ui/GoogleFormEmbed'
import { ShelfLabel } from '@/components/pot-noodle/ShelfLabel'
import { AwaitingResults, PublishedIndex } from '@/components/pot-noodle/IndexResults'
import { ShareIndex } from '@/components/pot-noodle/ShareIndex'
import { canonicalAlternates, pageOpenGraph, pageTwitter } from '@/lib/seo'
import { INSTAGRAM_URL, SITE_URL } from '@/lib/constants'
import { googleFormEmbedUrl, isGoogleFormLink } from '@/lib/googleForms'
import { POT_NOODLE_INDEX as PNI, publishableResults } from '@/lib/potNoodleIndex'
import './pot-noodle.css'

const PATH = '/pot-noodle-index'
const TITLE = 'The Pot Noodle Index'
const DESCRIPTION =
  'How far does a student budget actually stretch? The Pot Noodle Index compares everyday student costs across cities and universities, from the weekly shop to a pint at the student bar. Add your prices and share the form.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: canonicalAlternates(PATH),
  openGraph: pageOpenGraph(PATH, { title: `${TITLE} | The Consilium`, description: DESCRIPTION }),
  twitter: pageTwitter({ title: TITLE, description: DESCRIPTION }),
}

// Static: everything on the page comes from src/lib/potNoodleIndex.ts, so it is built once and
// served from the CDN. Nothing here reads the database, cookies or the session.

const sectionTitle = 'text-balance text-3xl font-bold leading-tight tracking-[-0.01em] text-[var(--fg)] sm:text-4xl'
const serif = { fontFamily: 'var(--font-serif)' }

const QUESTIONS = [
  { q: 'Where does a student budget stretch furthest?', a: 'How everyday costs compare between cities, universities and countries.' },
  { q: 'Which costs differ most?', a: 'From the weekly shop to a pint at the student bar: which everyday costs vary most from place to place.' },
  { q: 'How is it changing?', a: 'How those costs move over time, as responses keep coming in.' },
]

const STEPS = [
  { title: 'Think about what you spend', body: 'Your weekly shop, a pint at the student bar, the everyday costs of student life. Rough averages are fine.' },
  { title: 'Fill in the form', body: 'It takes about five minutes. Give prices in your local currency and tell us which one.' },
  { title: 'Pass it on', body: 'Share the form with friends and coursemates, wherever they study. Every response makes the index more reliable.' },
]

export default function PotNoodleIndexPage() {
  const results = publishableResults(PNI.results)
  const formUrl = isGoogleFormLink(PNI.form.responderUrl) ? PNI.form.responderUrl : null
  const embedUrl = googleFormEmbedUrl(formUrl)
  const pageUrl = `${SITE_URL.replace(/\/$/, '')}${PATH}`

  return (
    <div className="pni-page bg-[var(--bg)]">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section aria-labelledby="pni-title" className="pni-hero relative overflow-clip border-b-2 border-gold bg-navy text-cream">
        <div aria-hidden className="pni-hero-texture pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-12 lg:gap-8 lg:px-8 lg:pb-20 lg:pt-20">
          <div className="lg:col-span-7">
            <AnimateIn variant="fade-up" duration={0.6}>
              <p className="pni-status" data-status={results ? 'published' : PNI.status}>
                <span className="pni-status-dot" aria-hidden />
                {results ? 'Results published' : 'Collecting prices now'}
              </p>
              <h1 id="pni-title" className="mt-5 text-balance text-[2.75rem] font-bold leading-[1.02] tracking-[-0.02em] text-cream sm:text-6xl lg:text-[4.4rem]" style={serif}>
                The Pot Noodle Index
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-cream/80">
                How far does a student budget actually stretch? We’re comparing everyday student costs across cities and
                universities, from the weekly shop to a pint at the student bar, using prices you send us.
              </p>
            </AnimateIn>
            <AnimateIn variant="fade-up" delay={0.1} duration={0.6}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#take-part" className="btn-lift group inline-flex min-h-12 items-center gap-2 bg-gold px-6 text-sm font-bold uppercase tracking-[0.16em] text-navy hover:bg-gold-light">
                  Add your prices
                  <ArrowRight size={16} aria-hidden className="transition-transform duration-200 group-hover:translate-x-1" />
                </a>
                <a href="#about" className="btn-press inline-flex min-h-12 items-center border border-gold/60 px-6 text-sm font-bold uppercase tracking-[0.16em] text-gold transition-colors hover:border-gold hover:bg-gold/10">
                  What we’re measuring
                </a>
              </div>
            </AnimateIn>
          </div>
          <div className="flex justify-center lg:col-span-5 lg:justify-end">
            <ShelfLabel results={results} />
          </div>
        </div>
      </section>

      {/* ── What the index investigates ───────────────────────────────────── */}
      <section id="about" aria-labelledby="about-title" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-12">
          <AnimateIn className="lg:col-span-5">
            <h2 id="about-title" className={sectionTitle} style={serif}>A cost-of-living index for students</h2>
            <p className="mt-5 max-w-md leading-relaxed text-[var(--fg-muted)]">
              Economists have long used everyday purchases to compare prices across places and over time.{' '}
              <em>The Economist</em>’s Big Mac Index, started in 1986, is the best known. The Pot Noodle Index, named for the most
              basic of student staples, applies the idea to what students actually spend.
            </p>
          </AnimateIn>
          <div className="lg:col-span-7">
            <ul className="pni-questions" aria-label="What we want to find out">
              {QUESTIONS.map((item) => (
                <li key={item.q}>
                  <h3 className="text-xl font-bold leading-snug text-[var(--fg)]" style={serif}>{item.q}</h3>
                  <p className="mt-1.5 leading-relaxed text-[var(--fg-muted)]">{item.a}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm leading-relaxed text-[var(--fg-muted)]">
              These are the questions the index is designed to answer. How many of them it can answer depends on how many
              responses we receive, and from where.
            </p>
          </div>
        </div>
      </section>

      {/* ── Take part ─────────────────────────────────────────────────────── */}
      <section id="take-part" aria-labelledby="take-part-title" className="scroll-mt-20 border-y border-[var(--border)] bg-[var(--bg-subtle)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimateIn>
            <h2 id="take-part-title" className={sectionTitle} style={serif}>Add your prices</h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-[var(--fg-muted)]">
              The Pot Noodle Index is collecting data now and will be updated once we have enough responses. Please fill in the
              form and share it with others.
            </p>
          </AnimateIn>

          <ol className="pni-steps mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="pni-step-number" aria-hidden>{i + 1}</span>
                <h3 className="mt-4 text-lg font-bold text-[var(--fg)]" style={serif}>
                  <span className="sr-only">Step {i + 1}: </span>{s.title}
                </h3>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-12 grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-8">
              {formUrl ? (
                <GoogleFormEmbed
                  responderUrl={formUrl}
                  embedUrl={embedUrl}
                  title="The Pot Noodle Index submission form (Google Forms)"
                  label="The Pot Noodle Index · Google Forms"
                  intentHash="take-part"
                />
              ) : (
                <div className="pni-form-pending">
                  <p className="text-lg font-semibold text-[var(--fg)]" style={serif}>The form opens here soon</p>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--fg-muted)]">
                    We’re finishing the submission form. Check back shortly, or{' '}
                    <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                      follow The Consilium on Instagram<span className="sr-only"> (opens in a new tab)</span>
                    </a>{' '}
                    for the launch.
                  </p>
                </div>
              )}
            </div>
            <aside className="lg:col-span-4" aria-label="Sharing and privacy">
              <h3 className="text-lg font-bold text-[var(--fg)]" style={serif}>Share the form</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--fg-muted)]">
                The more cities and universities responses come from, the more the index can compare.
              </p>
              <div className="mt-4">
                <ShareIndex url={pageUrl} title={TITLE} text="How far does a student budget stretch? Add your prices to The Consilium’s Pot Noodle Index." />
              </div>
              <div className="mt-8 border-t border-[var(--border-strong)] pt-5 text-sm leading-relaxed text-[var(--fg-muted)]">
                <p>
                  Responses are collected by Google Forms, which confirms each submission inside the form. The form asks for your
                  name and email address; please don’t include anything else personal it doesn’t ask for.
                </p>
                <p className="mt-3">
                  How we handle data: <Link href="/privacy" className="font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold">Privacy Policy</Link>.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <section id="results" aria-labelledby="results-title" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid items-start gap-12 lg:grid-cols-12">
          <AnimateIn className="lg:col-span-5">
            <h2 id="results-title" className={sectionTitle} style={serif}>The index</h2>
            <p className="mt-5 max-w-md leading-relaxed text-[var(--fg-muted)]">
              {results
                ? 'The latest verified figures, with the dates they cover and the method behind them.'
                : 'No figures yet. The index will be published here, and in The Consilium’s newsletter, once there are enough responses for the numbers to mean something.'}
            </p>
          </AnimateIn>
          <div className="lg:col-span-7">{results ? <PublishedIndex results={results} /> : <AwaitingResults />}</div>
        </div>
      </section>

      {/* ── Method and updates ────────────────────────────────────────────── */}
      <section id="methodology" aria-labelledby="method-title" className="scroll-mt-20 border-t border-[var(--border)] bg-[var(--bg-subtle)]">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-24">
          <div className="lg:col-span-5">
            <h2 id="method-title" className={sectionTitle} style={serif}>Method and updates</h2>
          </div>
          <div className="grid gap-10 sm:grid-cols-2 lg:col-span-7">
            <div>
              <h3 className="text-lg font-bold text-[var(--fg)]" style={serif}>The method</h3>
              {results ? (
                <ul className="pni-ticks mt-3 space-y-2 text-[0.95rem] text-[var(--fg-muted)]">
                  {results.methodology.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : (
                <>
                  <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">
                    The full method will be published with the first results. It will set out:
                  </p>
                  <ul className="pni-ticks mt-3 space-y-2 text-[0.95rem] text-[var(--fg-muted)]">
                    <li>how responses are checked before they count</li>
                    <li>how prices given in different currencies are made comparable</li>
                    <li>how many responses a city or university needs before it is shown</li>
                    <li>how the index value is calculated</li>
                  </ul>
                </>
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--fg)]" style={serif}>Updates</h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">
                Each update will say when the data were collected and when this page last changed. Until then, this page shows
                no numbers.
              </p>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">
                Questions or a correction?{' '}
                <Link href="/contact" className="font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold">Contact us</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Other projects ────────────────────────────────────────────────── */}
      <section aria-label="More from The Consilium" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/trading-challenge" className="group inline-flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          Also from The Consilium: the EconSoc Trading Challenge
          <ArrowUpRight size={15} aria-hidden className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </section>
    </div>
  )
}
