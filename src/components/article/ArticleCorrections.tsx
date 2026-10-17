import Link from 'next/link'
import { CORRECTION_TYPE_LABELS, type PublicCorrection } from '@/lib/corrections/types'
import { correctionsHeading, summariseCorrections } from '@/lib/corrections/public'
import { formatCorrectionDate } from '@/lib/corrections/format'

/**
 * Public correction notices. Server components with no client JavaScript: they render for print,
 * with JavaScript disabled and for screen readers exactly as on screen. Every string is rendered
 * as React text (escaped); nothing here uses dangerouslySetInnerHTML.
 */

export { formatCorrectionDate }

const VERB: Record<PublicCorrection['type'], string> = {
  CORRECTION: 'corrected',
  CLARIFICATION: 'clarified',
  UPDATE: 'updated',
}

/** One short line near the top of the article, linking to the detailed notes. */
export function CorrectionNotice({ corrections }: { corrections: readonly PublicCorrection[] }) {
  const summary = summariseCorrections(corrections)
  if (!summary) return null
  const label = CORRECTION_TYPE_LABELS[summary.type]
  const plural = summary.total > 1
  return (
    <p className="correction-notice mb-8" role="note" aria-label={`${label} notice`} data-testid="correction-notice">
      <strong className="text-gold font-bold">{label}</strong>
      {summary.latestAt && (
        <>
          <span aria-hidden="true" className="mx-2 text-[var(--fg-faint)]">|</span>
          <time dateTime={summary.latestAt}>{formatCorrectionDate(summary.latestAt)}</time>
        </>
      )}
      <span className="block sm:inline sm:ml-2">
        This article has been {VERB[summary.type]} since it was first published.{' '}
        <a href="#corrections" className="text-gold underline underline-offset-2 hover:no-underline font-semibold">
          {plural ? `Read the ${summary.total} notes` : 'Read the note'}
          <span className="sr-only"> at the end of the article</span>
        </a>
      </span>
    </p>
  )
}

/** The permanent record beneath the article, oldest first. */
export function CorrectionsSection({ corrections }: { corrections: readonly PublicCorrection[] }) {
  if (corrections.length === 0) return null
  const heading = correctionsHeading(corrections)
  const byId = new Map(corrections.map((c) => [c.id, c]))
  const amendedBy = new Map(corrections.filter((c) => c.supersedesId).map((c) => [c.supersedesId as string, c]))

  return (
    <section
      id="corrections"
      aria-labelledby="corrections-heading"
      tabIndex={-1}
      className="article-corrections mt-10 pt-6 border-t border-[var(--border-strong)] scroll-mt-24 focus:outline-none"
      data-testid="corrections-section"
    >
      {/* Older links pointed at #correction-note; keep them working. */}
      <span id="correction-note" aria-hidden="true" />
      <h2
        id="corrections-heading"
        className="text-[0.7rem] text-gold font-bold uppercase tracking-[0.2em] mb-4"
      >
        {heading}
      </h2>
      <ol className="space-y-5 list-none p-0 m-0">
        {corrections.map((c) => {
          const label = CORRECTION_TYPE_LABELS[c.type]
          const amendment = amendedBy.get(c.id)
          const amends = c.supersedesId ? byId.get(c.supersedesId) : undefined
          return (
            <li key={c.id} id={`correction-${c.id}`} className="text-sm leading-relaxed" data-correction-type={c.type}>
              <p className="text-[var(--fg)] font-semibold text-xs uppercase tracking-wider mb-1">
                {label}
                <span aria-hidden="true" className="mx-2 font-normal text-[var(--fg-faint)]">|</span>
                {c.publishedAt
                  ? <time dateTime={c.publishedAt} className="font-normal normal-case tracking-normal">{formatCorrectionDate(c.publishedAt)}</time>
                  : <span className="font-normal normal-case tracking-normal text-[var(--fg-faint)]">Date not recorded</span>}
              </p>
              <p className="text-[var(--fg-muted)] whitespace-pre-line">
                {c.publicNote ?? 'This article was corrected before our current corrections record began; the details were not recorded.'}
              </p>
              {amends && (
                <p className="text-[var(--fg-faint)] text-xs mt-1">
                  This note amends the {CORRECTION_TYPE_LABELS[amends.type].toLowerCase()}
                  {amends.publishedAt ? ` of ${formatCorrectionDate(amends.publishedAt)}` : ' above'}.
                </p>
              )}
              {amendment && (
                <p className="text-[var(--fg-faint)] text-xs mt-1">
                  This note was itself amended
                  {amendment.publishedAt ? ` on ${formatCorrectionDate(amendment.publishedAt)}` : ''}
                  ; <a href={`#correction-${amendment.id}`} className="text-gold hover:underline">see the amendment</a>.
                </p>
              )}
            </li>
          )
        })}
      </ol>
      <p className="text-[var(--fg-faint)] text-xs mt-5">
        <Link href="/corrections" className="text-gold hover:underline">Read our corrections policy</Link>
        <span className="no-print">, including how to report an error.</span>
      </p>
    </section>
  )
}
