/**
 * Shared vocabulary for post-publication corrections. Safe to import from client components
 * (no database access). The rules themselves live in validation.ts and service.ts.
 */

export const CORRECTION_TYPES = ['CORRECTION', 'CLARIFICATION', 'UPDATE'] as const
export type CorrectionTypeValue = (typeof CORRECTION_TYPES)[number]

export const CORRECTION_STATUSES = ['PENDING', 'PUBLISHED', 'WITHDRAWN'] as const
export type CorrectionStatusValue = (typeof CORRECTION_STATUSES)[number]

export function isCorrectionType(value: unknown): value is CorrectionTypeValue {
  return typeof value === 'string' && (CORRECTION_TYPES as readonly string[]).includes(value)
}

/** Public label shown before each note, e.g. "Correction | 16 October 2026". */
export const CORRECTION_TYPE_LABELS: Record<CorrectionTypeValue, string> = {
  CORRECTION: 'Correction',
  CLARIFICATION: 'Clarification',
  UPDATE: 'Update',
}

/** One-line guidance shown to editors when choosing the type. */
export const CORRECTION_TYPE_GUIDANCE: Record<CorrectionTypeValue, string> = {
  CORRECTION: 'A fact was wrong when the article was published. The article text must be amended.',
  CLARIFICATION: 'Not wrong, but could reasonably mislead or lacked important context.',
  UPDATE: 'New information has emerged since publication. Not an admission of error.',
}

/** Limits enforced by the API and, for the public note, by a database CHECK as well. */
export const CORRECTION_LIMITS = {
  publicNote: 2000,
  originalText: 2000,
  correctedText: 2000,
  internalNote: 5000,
  withdrawnReason: 1000,
  title: 300,
  excerpt: 1000,
  coverImage: 2000,
  // Article bodies are TipTap JSON; generous, but bounded before any transaction opens.
  content: 2_000_000,
} as const

/**
 * What a correction amends: the reader-facing fields of the article. `coverImage` and `authorId` are optional
 * in stored snapshots (a row written before they were added leaves them out, meaning "unchanged"); the form
 * always sends them. `authorName` is a display snapshot only, never applied.
 */
export interface CorrectionText {
  title: string
  excerpt: string | null
  content: string
  coverImage?: string | null
  authorId?: string
  authorName?: string | null
}

/** What a reader sees for one published notice. No internal fields, ever. */
export interface PublicCorrection {
  id: string
  type: CorrectionTypeValue
  publicNote: string | null
  /** ISO string; null only for a migrated legacy correction whose date was never recorded. */
  publishedAt: string | null
  legacy: boolean
  supersedesId: string | null
}

/** Error codes the corrections API returns (stable: the editorial UI keys its messages on them). */
export type CorrectionErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CATEGORY_SCOPE_DENIED'
  | 'ARTICLE_NOT_PUBLISHED'
  | 'ARTICLE_CHANGED'
  | 'PENDING_CORRECTION_EXISTS'
  | 'CORRECTION_NOT_PENDING'
  | 'CORRECTION_CHANGED'
  | 'CORRECTION_ALREADY_AMENDED'
  | 'DUPLICATE_REQUEST'
  | 'NO_TEXT_CHANGE'
  | 'IMAGE_UNAVAILABLE'
  | 'INVALID_AUTHOR'
