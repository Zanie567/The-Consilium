import type { prisma } from '@/lib/prisma'
import { isPrismaSchemaMismatch } from '@/lib/apiResponse'
import type { CorrectionTypeValue, PublicCorrection } from './types'

/**
 * The public corrections record for one article: PUBLISHED notices only, oldest first, and only
 * the fields a reader may see. Internal notes, the original/corrected working text, the article
 * snapshots and every staff identity are never selected here.
 *
 * If the corrections table is missing (code deployed before migration 20261017120000) the page
 * must still render, so this falls back to the legacy single note instead of failing the article.
 */
export async function loadPublicCorrections(
  db: Pick<typeof prisma, 'articleCorrection'>,
  article: { id: string; corrected: boolean; correctionNote: string | null },
): Promise<PublicCorrection[]> {
  try {
    const rows = await db.articleCorrection.findMany({
      where: { articleId: article.id, status: 'PUBLISHED' },
      select: { id: true, type: true, publicNote: true, publishedAt: true, legacy: true, supersedesId: true, createdAt: true },
      // Legacy notes (no recorded date) predate everything issued in the app, so they come first.
      orderBy: [{ publishedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      publicNote: row.publicNote,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      legacy: row.legacy,
      supersedesId: row.supersedesId,
    }))
  } catch (error) {
    if (!isPrismaSchemaMismatch(error)) console.error('[corrections:public] falling back to the legacy note', error)
    return legacyFallback(article)
  }
}

export function legacyFallback(article: { id: string; corrected: boolean; correctionNote: string | null }): PublicCorrection[] {
  if (!article.corrected) return []
  return [{
    id: `legacy_${article.id}`,
    type: 'CORRECTION',
    publicNote: article.correctionNote?.trim() || null,
    publishedAt: null,
    legacy: true,
    supersedesId: null,
  }]
}

const PRECEDENCE: CorrectionTypeValue[] = ['CORRECTION', 'CLARIFICATION', 'UPDATE']

/**
 * The single notice shown near the top of the article: the most serious type present, the date of
 * the most recent notice, and how many there are. Null when there is nothing to show.
 */
export function summariseCorrections(corrections: readonly PublicCorrection[]) {
  if (corrections.length === 0) return null
  const type = PRECEDENCE.find((t) => corrections.some((c) => c.type === t)) ?? 'UPDATE'
  const dated = corrections.filter((c) => c.publishedAt).map((c) => c.publishedAt as string).sort()
  const counts = {
    CORRECTION: corrections.filter((c) => c.type === 'CORRECTION').length,
    CLARIFICATION: corrections.filter((c) => c.type === 'CLARIFICATION').length,
    UPDATE: corrections.filter((c) => c.type === 'UPDATE').length,
  }
  return { type, latestAt: dated.at(-1) ?? null, total: corrections.length, counts }
}

/** "Corrections" when any correction exists, otherwise the label of what is there. */
export function correctionsHeading(corrections: readonly PublicCorrection[]): string {
  if (corrections.some((c) => c.type === 'CORRECTION')) return 'Corrections'
  const hasClarification = corrections.some((c) => c.type === 'CLARIFICATION')
  const hasUpdate = corrections.some((c) => c.type === 'UPDATE')
  if (hasClarification && hasUpdate) return 'Clarifications and updates'
  return hasClarification ? 'Clarifications' : 'Updates'
}

/** schema.org CorrectionComment entries for the article's JSON-LD. */
export function correctionsStructuredData(corrections: readonly PublicCorrection[]) {
  return corrections
    .filter((c) => c.publicNote)
    .map((c) => ({
      '@type': 'CorrectionComment',
      text: c.publicNote,
      ...(c.publishedAt ? { datePublished: c.publishedAt } : {}),
    }))
}
