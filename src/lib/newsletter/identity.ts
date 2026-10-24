import { createHash, createHmac } from 'node:crypto'

/**
 * Newsletter address rules. `normaliseEmail` must stay identical to the database function
 * public.consilium_subscriber_identity (lower(btrim(...)) over the JavaScript String.trim() set), which
 * backs the subscribers unique index, so the application and the index always agree on "the same address".
 */

// Same rule the signup form and /api/subscribe have always used, so no address changes validity.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254

/** The canonical identity of an address, or null when it is not a usable email address. */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const identity = value.trim().toLowerCase()
  if (!identity || identity.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(identity)) return null
  return identity
}

/**
 * Stable, non-reversible key for consent and suppression records that must outlive the subscriber row.
 * Matches the SQL in migration 20261023120000:
 *   encode(sha256(convert_to('consilium-newsletter:v1:' || identity, 'UTF8')), 'hex')
 */
export function emailHash(identity: string): string {
  return createHash('sha256').update(`consilium-newsletter:v1:${identity}`, 'utf8').digest('hex')
}

/**
 * Keyed hash of the requester's IP for consent proof. Returns null when no key is configured, so an
 * unkeyed (dictionary-reversible) IP hash is never stored.
 */
export function ipHash(ip: string | null | undefined): string | null {
  const key = process.env.NEWSLETTER_IP_HASH_SECRET || process.env.NEXTAUTH_SECRET
  if (!key || !ip || ip === 'unknown') return null
  return createHmac('sha256', key).update(`consilium-newsletter-ip:v1:${ip}`).digest('hex').slice(0, 32)
}

/** User agent kept for consent proof, truncated and stripped of control characters. */
export function consentUserAgent(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned ? cleaned.slice(0, 200) : null
}
