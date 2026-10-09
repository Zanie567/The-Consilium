import { NextResponse } from 'next/server'
import { TeamCardError } from '@/lib/teamCards'
import { apiServerErrorResponse } from '@/lib/apiResponse'

/** Maps a typed integrity failure to its HTTP response; anything else is a logged 500. */
export function teamCardErrorResponse(error: unknown, operation: string): NextResponse {
  if (error instanceof TeamCardError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  return apiServerErrorResponse(error, {
    operation,
    userMessage: 'The team profile could not be saved. Nothing was changed. Try again.',
    code: 'TEAM_CARD_FAILED',
  })
}

/** Reads a JSON object body, or null if it is missing, malformed, or not an object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

/** `undefined` leaves the owner alone, `null`/'' unlinks, a string links. Anything else is rejected. */
export function parseOwnerField(value: unknown): { ok: true; userId: string | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, userId: undefined }
  if (value === null || value === '') return { ok: true, userId: null }
  return typeof value === 'string' ? { ok: true, userId: value } : { ok: false }
}
