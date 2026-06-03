import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/** Constant-time secret comparison so the auth check does not leak via timing. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Validates an `Authorization: Bearer <CRON_SECRET>` request against the
 * CRON_SECRET environment variable.
 *
 * Returns a NextResponse to send back on failure (500 when CRON_SECRET is unset,
 * 401 when the header is missing or wrong), or null when the request is
 * authorised and the caller may proceed.
 *
 * @param label short tag used in server logs, e.g. 'recalculate-streaks'
 */
export function verifyCronAuth(req: Request, label: string): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error(`[${label}] CRON_SECRET env var is not set`)
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''
  if (!provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
