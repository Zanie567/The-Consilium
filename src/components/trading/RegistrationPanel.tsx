'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, Check, Copy, GraduationCap, IdCard, Mail } from 'lucide-react'
import { getCookieConsent } from '@/components/ui/CookieConsent'

/**
 * Registration: choose a route.
 *   - University of Edinburgh students complete the Google Form (automated
 *     verification by the existing Form → Sheet → Apps Script system).
 *   - Paid non-student members email the committee, who register them and verify
 *     their membership by hand. Nothing about that route is automated.
 *
 * The Google Form stays the source of truth for submission. This component never
 * claims a registration succeeded: it cannot see inside the cross-origin form and
 * does not try to.
 *
 * Loading the form (performance and privacy): the iframe loads Google's scripts and
 * may let Google set cookies, so it is not part of the initial page load. It loads
 *   - automatically as the section nears the viewport, for visitors who accepted
 *     cookies on this site, or
 *   - as soon as the visitor shows intent: "Enter the Challenge" (#register),
 *     choosing a route, or the "Load the form" button.
 * The direct "Open in Google Forms" link is visible throughout, works without
 * JavaScript, and is the fallback if the embed is blocked or slow.
 */

export type RouteKey = 'student' | 'member'

interface FormRoute {
  responderUrl: string | null
  embedUrl: string | null
}

const SLOW_MS = 12_000

function FormFrame({ route, title, intent, fields }: { route: FormRoute & { label: string }; title: string; intent: number; fields: string[] }) {
  const [requested, setRequested] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const statusId = useId()

  // Choosing this route (or re-choosing it) is explicit intent to register.
  useEffect(() => {
    if (intent > 0) setRequested(true)
  }, [intent])

  // Near-viewport autoload, only with prior cookie consent. A hidden route's frame
  // never intersects, so only the visible route can load this way.
  useEffect(() => {
    if (requested || !route.embedUrl) return
    const el = frameRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && getCookieConsent() === 'accepted') {
          setRequested(true)
          io.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [requested, route.embedUrl])

  // Explicit intent: arriving at or following a link to #register.
  useEffect(() => {
    if (!route.embedUrl) return
    const check = () => {
      if (window.location.hash === '#register') setRequested(true)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [route.embedUrl])

  useEffect(() => {
    if (!requested || loaded) return
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [requested, loaded])

  return (
    <div className="trading-form-frame border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">{route.label}</p>
        {route.responderUrl && (
          <a
            href={route.responderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold"
          >
            Open in Google Forms
            <ArrowUpRight size={15} aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>

      {/* The frame grows to the form's height only when the form is requested (a click, or
          the consented autoload while it is still off-screen), and the iframe then fills a
          fixed box, so the form's own loading never shifts the page. */}
      <div ref={frameRef} className={`relative transition-[height] duration-300 ${requested ? 'h-[1180px] sm:h-[1080px] lg:h-[980px]' : 'h-[34rem]'}`}>
        {requested && route.embedUrl ? (
          <>
            <iframe
              src={route.embedUrl}
              title={title}
              className="absolute inset-0 h-full w-full border-0 bg-white"
              onLoad={() => setLoaded(true)}
              referrerPolicy="strict-origin-when-cross-origin"
              // The form needs scripts, its own origin and submission; nothing may navigate this page.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
            {!loaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg-elevated)] px-6 text-center">
                <span className="trading-spinner" aria-hidden />
                <p id={statusId} role="status" className="text-sm text-[var(--fg-muted)]">
                  {slow ? (
                    <>
                      The form is taking a while to load.{' '}
                      {route.responderUrl && (
                        <a href={route.responderUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--fg)] underline decoration-gold underline-offset-4">
                          Open it in Google Forms instead
                        </a>
                      )}
                    </>
                  ) : (
                    'Loading the registration form…'
                  )}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-start gap-5 px-6 pt-10 text-center sm:pt-12">
            <div className="trading-form-ghost w-full max-w-md text-left" aria-hidden>
              {fields.map((f) => <span key={f}>{f}</span>)}
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-[var(--fg-muted)]">
              The form is hosted by Google Forms. Loading it here lets Google set its own cookies.
            </p>
            <button
              type="button"
              onClick={() => setRequested(true)}
              className="btn-lift inline-flex min-h-12 items-center gap-2 bg-navy px-6 text-sm font-bold uppercase tracking-[0.16em] text-gold hover:bg-navy-light dark:bg-gold dark:text-navy dark:hover:bg-gold-light"
            >
              Load the form here
            </button>
            {/* Without JavaScript the button cannot work; the header link above always does. */}
            <noscript>
              <p className="text-sm text-[var(--fg-muted)]">Use “Open in Google Forms” above to register.</p>
            </noscript>
          </div>
        )}
      </div>
    </div>
  )
}

export function RegistrationPanel({
  student,
  nonStudentMailto,
  supportEmail,
  membershipUrl,
  lateEntry,
}: {
  student: FormRoute
  /** mailto: link with the non-student subject and prefilled template. */
  nonStudentMailto: string
  supportEmail: string
  membershipUrl: string
  /** True once trading has started: late entry is allowed. */
  lateEntry: boolean
}) {
  const [route, setRoute] = useState<RouteKey>('student')
  const [intent, setIntent] = useState<Record<RouteKey, number>>({ student: 0, member: 0 })
  const name = useId()

  const choose = (next: RouteKey) => {
    setRoute(next)
    setIntent((current) => ({ ...current, [next]: current[next] + 1 }))
  }

  const options: { key: RouteKey; title: string; detail: string; icon: React.ReactNode }[] = [
    { key: 'student', title: 'I’m a University of Edinburgh student', detail: 'Verified automatically with your student number', icon: <GraduationCap size={22} aria-hidden /> },
    { key: 'member', title: 'I’m a non-student EconSoc member', detail: 'Register by email with the committee', icon: <IdCard size={22} aria-hidden /> },
  ]

  return (
    <div>
      <fieldset>
        <legend className="mb-4 text-sm font-semibold text-[var(--fg)]">Which describes you?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((o) => (
            <label key={o.key} className="trading-route group relative flex cursor-pointer items-start gap-4 border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 py-4">
              <input
                type="radio"
                name={name}
                value={o.key}
                checked={route === o.key}
                onChange={() => choose(o.key)}
                onClick={() => { if (route === o.key) choose(o.key) }}
                className="trading-route-input peer sr-only"
              />
              <span className="trading-route-icon mt-0.5 text-[var(--fg-muted)]">{o.icon}</span>
              <span>
                <span className="block font-semibold leading-snug text-[var(--fg)]">{o.title}</span>
                <span className="mt-1 block text-sm text-[var(--fg-muted)]">{o.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {lateEntry && (
        <p className="mt-5 text-sm text-[var(--fg-muted)]">
          <span className="font-semibold text-[var(--fg)]">Joining late?</span> You can still enter. Everyone starts
          with the same virtual $100,000, so joining later simply means less time to trade.
        </p>
      )}

      <div className="trading-route-panel mt-8" hidden={route !== 'student'}>
        {/* Phones read: what you need → the form → what happens next. Wide screens
            put both notes in the left column beside the form. */}
        <div className="grid gap-10 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-0">
          <div className="lg:col-span-5 lg:col-start-1 lg:row-start-1">
            <h3 className="text-xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
              Student registration
            </h3>
            <h4 className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">You will need</h4>
            <ul className="trading-ticks mt-3 space-y-2 text-[0.95rem] text-[var(--fg)]">
              <li>Your full name</li>
              <li>Your University of Edinburgh student number</li>
              <li>
                Your MarketWatch username: the name you trade under, <em>not</em> your email address
              </li>
            </ul>

          </div>

          <div className="lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1">
            {student.responderUrl ? (
              <FormFrame
                route={{ ...student, label: 'Student registration · Google Forms' }}
                title="EconSoc Trading Challenge student registration form (Google Forms)"
                fields={['Full name', 'Student number', 'MarketWatch username']}
                intent={intent.student}
              />
            ) : (
              <Unavailable supportEmail={supportEmail} />
            )}
          </div>

          <div className="lg:col-span-5 lg:col-start-1 lg:row-start-2">
            <h4 className="text-xs lg:mt-8 font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">What happens next</h4>
            <ol className="trading-sequence mt-3 space-y-4 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">
              <li>
                <span className="font-semibold text-[var(--fg)]">We check your student number</span> against EconSoc’s
                membership list.
              </li>
              <li>
                <span className="font-semibold text-[var(--fg)]">If you’re on it,</span> the private game link and password
                are emailed to your university address, usually shortly after you register.
              </li>
              <li>
                <span className="font-semibold text-[var(--fg)]">If you’re not on it yet,</span> you’ll get an email saying
                your registration is pending. Pending registrations are rechecked every hour, but the membership list is
                refreshed from EUSA’s records periodically rather than instantly, so{' '}
                <span className="text-[var(--fg)]">a membership bought recently can take longer to verify</span>. There’s
                no need to register again.
              </li>
            </ol>

            <div className="mt-8 border-t border-[var(--border-strong)] pt-5 text-sm leading-relaxed text-[var(--fg-muted)]">
              <p>
                Check your junk or spam folder. If nothing arrives, email{' '}
                <a href={`mailto:${supportEmail}`} className="inline-flex items-center gap-1 font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                  <Mail size={14} aria-hidden />
                  {supportEmail}
                </a>{' '}
                with your name and MarketWatch username. Never send your password.
              </p>
              <p className="mt-3">
                Submitting the form registers you with EconSoc. It is not the same as joining the game on MarketWatch: you
                join with the password we send you.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="trading-route-panel mt-8" hidden={route !== 'member'}>
        <NonStudentContact mailto={nonStudentMailto} email={supportEmail} membershipUrl={membershipUrl} />
      </div>
    </div>
  )
}

const noSubscribe = () => () => {}

/** Non-student members register by emailing the committee. */
function NonStudentContact({ mailto, email, membershipUrl }: { mailto: string; email: string; membershipUrl: string }) {
  const [copied, setCopied] = useState(false)
  // Offer "Copy" only where the Clipboard API exists (it needs a secure context).
  // The server render leaves it out; it never changes after load.
  const canCopy = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.clipboard?.writeText === 'function',
    () => false,
  )

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2400)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
    } catch {
      // Clipboard permission refused: the address stays visible to copy by hand.
    }
  }

  return (
    <div className="trading-contact relative overflow-hidden border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
      <div className="grid lg:grid-cols-12">
        <div className="px-6 py-9 sm:px-10 sm:py-11 lg:col-span-7">
          <h3 className="text-balance text-2xl font-bold leading-snug text-[var(--fg)] sm:text-[1.75rem]" style={{ fontFamily: 'var(--font-serif)' }}>
            Not a University of Edinburgh student?
          </h3>
          <p className="mt-4 max-w-xl leading-relaxed text-[var(--fg-muted)]">
            Paid non-student EconSoc members are welcome to participate in the Trading Challenge.
          </p>
          <p className="mt-3 max-w-xl leading-relaxed text-[var(--fg-muted)]">
            To register, simply get in touch with our committee. We’ll guide you through the process, verify your membership
            and provide the details you need to join.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-4">
            <a
              href={mailto}
              className="btn-lift trading-cta inline-flex min-h-12 w-full items-center justify-center gap-2.5 bg-navy px-5 text-[0.8rem] font-bold uppercase tracking-[0.1em] text-gold hover:bg-navy-light sm:w-auto sm:px-6 sm:text-sm sm:tracking-[0.14em] dark:bg-gold dark:text-navy dark:hover:bg-gold-light"
            >
              <Mail size={16} aria-hidden className="shrink-0" />
              Contact EconSoc to Register
            </a>
            <span className="inline-flex items-center gap-1">
              <a href={mailto} className="break-all font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                {email}
              </a>
              {canCopy && (
                <button
                  type="button"
                  onClick={copy}
                  className="btn-press inline-flex h-11 w-11 shrink-0 items-center justify-center text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
                  aria-label={copied ? 'Email address copied' : 'Copy email address'}
                >
                  {copied ? <Check size={16} aria-hidden className="text-gold-dark dark:text-gold" /> : <Copy size={16} aria-hidden />}
                </button>
              )}
              <span role="status" className="sr-only">{copied ? 'Email address copied' : ''}</span>
            </span>
          </div>
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] px-6 py-9 sm:px-10 sm:py-11 lg:col-span-5 lg:border-l lg:border-t-0">
          <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">Include in your email</h4>
          <ul className="trading-ticks mt-4 space-y-2.5 text-[0.95rem] text-[var(--fg)]">
            <li>Your full name</li>
            <li>Your MarketWatch display name</li>
            <li>The email address you used to buy your EconSoc membership</li>
          </ul>
          <p className="mt-6 text-sm leading-relaxed text-[var(--fg-muted)]">
            The button starts an email with these lines ready to fill in. Never send a password. The committee checks your
            membership by hand, so your login details follow once that check is done.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--fg-muted)]">
            Not a member yet?{' '}
            <a href={membershipUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
              Buy EconSoc membership
              <ArrowUpRight size={14} aria-hidden />
              <span className="sr-only">(opens EUSA in a new tab)</span>
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

function Unavailable({ supportEmail }: { supportEmail: string }) {
  return (
    <div className="border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] px-6 py-10">
      <p className="text-lg font-semibold text-[var(--fg)]">The registration form isn’t available right now.</p>
      <p className="mt-2 text-[var(--fg-muted)]">
        Please email <a href={`mailto:${supportEmail}`} className="font-semibold underline decoration-gold underline-offset-4">{supportEmail}</a>.
      </p>
    </div>
  )
}
