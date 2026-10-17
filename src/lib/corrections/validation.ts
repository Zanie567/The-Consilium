import { figureAltError } from '@/lib/figureValidation'
import {
  CORRECTION_LIMITS,
  isCorrectionType,
  type CorrectionText,
  type CorrectionTypeValue,
} from './types'

/**
 * Pure parsing of a correction request body. Nothing here trusts the client for identity,
 * timestamps or status: those come from the session and the server clock (service.ts).
 */

export interface CorrectionDraftInput {
  type: CorrectionTypeValue
  publicNote: string
  originalText: string | null
  correctedText: string | null
  internalNote: string | null
  text: CorrectionText
  baseVersion: string
  supersedesId: string | null
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const REQUEST_KEY = /^[A-Za-z0-9_-]{16,100}$/
const VERSION = /^[0-9a-f]{24}$/

function optionalText(value: unknown, max: number, label: string): ParseResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: `${label} must be text.` }
  const trimmed = value.trim()
  if (trimmed.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` }
  return { ok: true, value: trimmed || null }
}

export function parseRequestKey(value: unknown): ParseResult<string> {
  return typeof value === 'string' && REQUEST_KEY.test(value)
    ? { ok: true, value }
    : { ok: false, error: 'This request is missing its submission key. Reload the page and try again.' }
}

export function parseCorrectionDraft(body: unknown): ParseResult<CorrectionDraftInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'The request body is missing.' }
  const b = body as Record<string, unknown>

  if (!isCorrectionType(b.type)) return { ok: false, error: 'Choose correction, clarification or update.' }
  const type = b.type

  if (typeof b.publicNote !== 'string' || !b.publicNote.trim()) {
    return { ok: false, error: 'Write the public note readers will see.' }
  }
  const publicNote = b.publicNote.trim()
  if (publicNote.length > CORRECTION_LIMITS.publicNote) {
    return { ok: false, error: `The public note must be ${CORRECTION_LIMITS.publicNote} characters or fewer.` }
  }

  const originalText = optionalText(b.originalText, CORRECTION_LIMITS.originalText, 'The original claim')
  if (!originalText.ok) return originalText
  const correctedText = optionalText(b.correctedText, CORRECTION_LIMITS.correctedText, 'The corrected information')
  if (!correctedText.ok) return correctedText
  const internalNote = optionalText(b.internalNote, CORRECTION_LIMITS.internalNote, 'The internal note')
  if (!internalNote.ok) return internalNote

  if (type === 'CORRECTION' && (!originalText.value || !correctedText.value)) {
    return { ok: false, error: 'For a correction, record what the article originally said and what is correct.' }
  }
  if (type === 'CLARIFICATION' && !originalText.value) {
    return { ok: false, error: 'For a clarification, record the statement that could mislead readers.' }
  }

  if (typeof b.title !== 'string' || !b.title.trim()) return { ok: false, error: 'The article needs a title.' }
  if (b.title.length > CORRECTION_LIMITS.title) return { ok: false, error: 'The title is too long.' }
  if (b.excerpt !== null && b.excerpt !== undefined && typeof b.excerpt !== 'string') {
    return { ok: false, error: 'The standfirst must be text.' }
  }
  const excerpt = typeof b.excerpt === 'string' ? b.excerpt : null
  if (excerpt && excerpt.length > CORRECTION_LIMITS.excerpt) return { ok: false, error: 'The standfirst is too long.' }
  if (typeof b.content !== 'string' || !b.content.trim()) return { ok: false, error: 'The article text is missing.' }
  if (b.content.length > CORRECTION_LIMITS.content) return { ok: false, error: 'The article text is too long.' }
  const altError = figureAltError(b.content)
  if (altError) return { ok: false, error: altError }

  if (typeof b.baseVersion !== 'string' || !VERSION.test(b.baseVersion)) {
    return { ok: false, error: 'This form does not say which version of the article it was prepared from. Reload and try again.' }
  }
  if (b.supersedesId !== undefined && b.supersedesId !== null && (typeof b.supersedesId !== 'string' || !b.supersedesId)) {
    return { ok: false, error: 'The correction being amended is not valid.' }
  }

  return {
    ok: true,
    value: {
      type,
      publicNote,
      originalText: originalText.value,
      correctedText: correctedText.value,
      internalNote: internalNote.value,
      text: { title: b.title.trim(), excerpt, content: b.content },
      baseVersion: b.baseVersion,
      supersedesId: typeof b.supersedesId === 'string' ? b.supersedesId : null,
    },
  }
}

export function parseWithdrawReason(value: unknown): ParseResult<string> {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'Say briefly why this correction is being withdrawn.' }
  const reason = value.trim()
  if (reason.length > CORRECTION_LIMITS.withdrawnReason) return { ok: false, error: 'The reason is too long.' }
  return { ok: true, value: reason }
}

/** Strict ISO timestamp the client echoes back from a row it loaded (optimistic concurrency). */
export function parseRevision(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

const normaliseExcerpt = (excerpt: string | null | undefined) => (excerpt ?? '').trim()

/** True when the proposed reader-facing text differs from what is live. */
export function textChanged(current: CorrectionText, proposed: CorrectionText): boolean {
  return current.title !== proposed.title
    || normaliseExcerpt(current.excerpt) !== normaliseExcerpt(proposed.excerpt)
    || current.content !== proposed.content
}

/**
 * The public note an editor starts from. A template only: the editor edits it freely, and the
 * note they submit is the one published.
 */
export function suggestPublicNote(type: CorrectionTypeValue, originalText: string, correctedText: string): string {
  const original = originalText.trim().replace(/[.\s]+$/, '')
  const corrected = correctedText.trim().replace(/[.\s]+$/, '')
  switch (type) {
    case 'CORRECTION':
      return `An earlier version of this article stated that ${original || '…'}. ${corrected ? `${capitalise(corrected)}.` : ''} The article has been amended.`.replace(/\s+/g, ' ').trim()
    case 'CLARIFICATION':
      return `An earlier version of this article said that ${original || '…'}. ${corrected ? `${capitalise(corrected)}.` : ''} The article has been clarified.`.replace(/\s+/g, ' ').trim()
    case 'UPDATE':
      return `This article was updated to reflect ${corrected || original || 'new information'}.`.replace(/\s+/g, ' ').trim()
  }
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}
