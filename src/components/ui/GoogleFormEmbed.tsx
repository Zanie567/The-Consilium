'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { getCookieConsent } from '@/components/ui/CookieConsent'

const SLOW_MS = 12_000

interface GoogleFormEmbedProps {
  /** The responder link people can always open directly. */
  responderUrl: string
  /** docs.google.com embed URL, or null when the link cannot be embedded (a forms.gle short link). */
  embedUrl: string | null
  /** Accessible name of the iframe. */
  title: string
  /** Header label above the frame. */
  label: string
  /** Loads the form at once when the page is opened at, or later navigates to, this #hash. */
  intentHash?: string
  /** Frame height classes once loaded; the form scrolls inside it. */
  frameHeight?: string
}

/**
 * An embedded Google Form that respects the visitor's privacy and the page's speed.
 *
 * The iframe loads Google's scripts and may let Google set cookies, so it is not part of the initial
 * page load. It loads
 *   - automatically as it nears the viewport, only for visitors who accepted cookies on this site, or
 *   - when the visitor asks: the "Load the form here" button, or a link to `#intentHash`.
 * The direct "Open in Google Forms" link is visible throughout, works without JavaScript, and is the
 * fallback when the embed is blocked or slow.
 *
 * It never claims a submission succeeded: the form is cross-origin, so only Google's own confirmation
 * inside the frame can say that.
 *
 * Extracted from the Trading Challenge registration panel's form frame, which keeps its own copy.
 */
export function GoogleFormEmbed({ responderUrl, embedUrl, title, label, intentHash, frameHeight = 'h-[1100px] sm:h-[1000px]' }: GoogleFormEmbedProps) {
  const [requested, setRequested] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const statusId = useId()

  useEffect(() => {
    if (requested || !embedUrl) return
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
  }, [requested, embedUrl])

  useEffect(() => {
    if (!embedUrl || !intentHash) return
    const check = () => { if (window.location.hash === `#${intentHash}`) setRequested(true) }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [embedUrl, intentHash])

  useEffect(() => {
    if (!requested || loaded) return
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [requested, loaded])

  const direct = (
    <a
      href={responderUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold"
    >
      Open in Google Forms
      <ArrowUpRight size={15} aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )

  return (
    <div className="border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">{label}</p>
        {direct}
      </div>

      {!embedUrl ? (
        <div className="px-6 py-10 text-center">
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-[var(--fg-muted)]">
            This form opens on Google Forms.
          </p>
          <div className="mt-4">{direct}</div>
        </div>
      ) : (
        <div ref={frameRef} className={`relative transition-[height] duration-300 ${requested ? frameHeight : 'h-[26rem]'}`}>
          {requested ? (
            <>
              <iframe
                src={embedUrl}
                title={title}
                className="absolute inset-0 h-full w-full border-0 bg-white"
                onLoad={() => setLoaded(true)}
                referrerPolicy="strict-origin-when-cross-origin"
                // The form needs scripts, its own origin and submission; nothing may navigate this page.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              />
              {!loaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg-elevated)] px-6 text-center">
                  <span className="form-embed-spinner" aria-hidden />
                  <p id={statusId} role="status" className="text-sm text-[var(--fg-muted)]">
                    {slow ? (
                      <>
                        The form is taking a while to load.{' '}
                        <a href={responderUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--fg)] underline decoration-gold underline-offset-4">
                          Open it in Google Forms instead
                        </a>
                      </>
                    ) : (
                      'Loading the form…'
                    )}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
              <div className="form-embed-ghost w-full max-w-md" aria-hidden>
                <span /><span /><span />
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
              <noscript>
                <p className="text-sm text-[var(--fg-muted)]">Use “Open in Google Forms” above.</p>
              </noscript>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
