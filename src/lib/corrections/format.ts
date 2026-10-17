import { CORRECTION_TYPE_LABELS, type CorrectionTypeValue } from './types'

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })

/** "16 October 2026", in UK editorial time (shared by the public page and the legacy mirror). */
export function formatCorrectionDate(iso: string | Date): string {
  return DATE.format(typeof iso === 'string' ? new Date(iso) : iso)
}

export interface MirrorNotice {
  type: CorrectionTypeValue
  publicNote: string | null
  publishedAt: Date | string | null
}

/**
 * The text written to the legacy `articles."correctionNote"` column: every published notice, oldest first, each
 * with its own label and date. Only an older build reads it (after a code rollback), and that build shows one
 * box headed "Correction Note"; carrying every notice with its true label means a rollback never silently drops
 * a clarification or update, and never presents one as a correction without saying what it is.
 */
export function composeLegacyMirror(notices: readonly MirrorNotice[]): string | null {
  if (notices.length === 0) return null
  return notices
    .map((n) => {
      const label = CORRECTION_TYPE_LABELS[n.type]
      const date = n.publishedAt ? formatCorrectionDate(n.publishedAt) : 'date not recorded'
      const note = n.publicNote?.trim() || 'The details of this earlier correction were not recorded.'
      return `${label} (${date}): ${note}`
    })
    .join('\n\n')
}
