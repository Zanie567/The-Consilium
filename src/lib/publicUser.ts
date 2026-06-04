/**
 * Safe field selections for exposing a User through a public-facing relation
 * (most commonly an article's `author`).
 *
 * A bare `include: { author: true }` serialises every User column — including
 * `email`, `isBanned`, `bannedReason`, `failedLoginAttempts`, `lockedUntil` and
 * `adminNotes` — to whoever receives the response. For endpoints reachable by
 * unauthenticated visitors (the public article list and the published-article
 * read) that is a privacy leak. Use this select instead so only the fields a
 * byline actually needs are returned.
 *
 * The password hash is additionally stripped globally by the Prisma client's
 * `omit` config (see lib/prisma.ts); this select is the second layer that also
 * keeps email and the account-security columns out of public payloads.
 */
export const PUBLIC_AUTHOR_SELECT = {
  id: true,
  name: true,
  slug: true,
  image: true,
  bio: true,
} as const

/** User columns that must never appear in a public-facing payload. */
export const SENSITIVE_USER_FIELDS = [
  'password',
  'email',
  'isBanned',
  'bannedReason',
  'bannedBy',
  'bannedAt',
  'failedLoginAttempts',
  'lockedUntil',
  'adminNotes',
  'isActive',
  'emailVerified',
] as const
