import { NextResponse } from 'next/server'

/**
 * The database refuses to make an article public while its debate is unpublished or deleted
 * (trigger `articles_hidden_debate_guard`, migration 20261011). That trigger is the authority;
 * these helpers only turn its refusal into a clear 409 instead of a generic 500, so every
 * write path reports it the same way.
 */
export const HIDDEN_DEBATE_CODE = 'HIDDEN_DEBATE_ARTICLE'
export const HIDDEN_DEBATE_MESSAGE =
  'This article belongs to a debate that is unpublished or deleted, so it cannot be made public. ' +
  'An administrator can publish or restore the debate from Debates.'

/** True when `error` (or anything it wraps) is the trigger's refusal. */
export function isHiddenDebateViolation(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) return false
  if (typeof error === 'string') return error.includes(HIDDEN_DEBATE_CODE)
  if (typeof error !== 'object') return false
  const e = error as { message?: unknown; cause?: unknown; meta?: unknown }
  if (typeof e.message === 'string' && e.message.includes(HIDDEN_DEBATE_CODE)) return true
  if (e.meta && JSON.stringify(e.meta).includes(HIDDEN_DEBATE_CODE)) return true
  return isHiddenDebateViolation(e.cause, depth + 1)
}

export function hiddenDebateResponse(): NextResponse {
  return NextResponse.json({ error: HIDDEN_DEBATE_MESSAGE, code: HIDDEN_DEBATE_CODE }, { status: 409 })
}
