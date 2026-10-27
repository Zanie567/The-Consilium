import { createHash, randomBytes } from 'node:crypto'

/**
 * Email-link tokens. 32 random bytes, base64url in the link; only the SHA-256 is stored, so a database
 * read never yields a usable link. Consumption is a single conditional UPDATE, so a token can be used once
 * even when two requests race.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: hashToken(raw) }
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Shape check before any database lookup (rejects arrays, padding, oversized input). */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}
