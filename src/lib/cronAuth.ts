import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Constant-time secret comparison. Both inputs are reduced to fixed-length SHA-256
 * digests before comparison so the running time does not depend on input length; a
 * raw length-equality guard would leak the secret's length through timing.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Validates a cron request against the CRON_SECRET environment variable. The
 * secret may be supplied either as `Authorization: Bearer <CRON_SECRET>` or as
 * an `x-cron-secret: <CRON_SECRET>` header — different workflows in this repo use
 * different conventions, and both are accepted here so every cron route can share
 * one constant-time check.
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

  // Accept when EITHER header carries the secret, compared independently so a
  // wrong Bearer header cannot mask a valid x-cron-secret (and vice versa).
  // Each comparison stays constant-time via secretsMatch.
  if (!presentedSecrets(req).some((provided) => secretsMatch(provided, secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

/** The non-empty credentials a request carries: its Bearer token and its x-cron-secret header. */
function presentedSecrets(req: Request): string[] {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
  const headerSecret = req.headers.get('x-cron-secret')?.trim() ?? ''
  return [bearer, headerSecret].filter((s) => s !== '')
}

/** A dedicated secret shorter than this is not accepted: it is a typo or a placeholder, not a secret. */
const MIN_PUBLISH_SECRET_LENGTH = 32

/**
 * Authorises a call to POST /api/publish-scheduled, and ONLY that route.
 *
 * Accepts either of two credentials:
 *   - PUBLISH_CRON_SECRET: a secret that can publish and can do nothing else. It is what Supabase
 *     Cron sends, from Vault. Every other cron route authenticates with verifyCronAuth, which never
 *     reads this variable, so holding it cannot purge trash or run any other job. A test enforces that
 *     no other module mentions it.
 *   - CRON_SECRET: what the GitHub Actions workflow sends today. Accepting it keeps GitHub publishing
 *     unchanged through the transition and makes rollback a one-command change; nothing is rotated.
 *
 * Returns a NextResponse to send on failure (500 when no usable secret is configured at all, 401 when
 * the presented credential matches neither), or null when the request may proceed.
 */
export function verifyPublishCronAuth(req: Request, label: string): NextResponse | null {
  const shared = process.env.CRON_SECRET
  let dedicated = process.env.PUBLISH_CRON_SECRET
  if (dedicated !== undefined && dedicated !== '' && dedicated.length < MIN_PUBLISH_SECRET_LENGTH) {
    // Never log the value, only that it was rejected.
    console.error(`[${label}] PUBLISH_CRON_SECRET is shorter than ${MIN_PUBLISH_SECRET_LENGTH} characters and is being ignored`)
    dedicated = undefined
  }
  const accepted = [dedicated, shared].filter((s): s is string => Boolean(s))
  if (accepted.length === 0) {
    console.error(`[${label}] neither PUBLISH_CRON_SECRET nor CRON_SECRET is set`)
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  // Every presented credential is checked against every accepted secret with no early exit between
  // secrets, so which of the two matched is not observable through timing.
  let authorized = false
  for (const provided of presentedSecrets(req)) {
    for (const secret of accepted) {
      if (secretsMatch(provided, secret)) authorized = true
    }
  }
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
