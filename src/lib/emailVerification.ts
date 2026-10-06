/**
 * Proof that an account controls its email address, by emailed single-use link.
 *
 * Why this exists: credentials sign-up does not check the address, so without it
 * anyone could register an invited member's email and inherit their role. An
 * invitation is only ever claimed by an account whose address is VERIFIED; this is how
 * a password account gets there (Google accounts arrive verified).
 *
 * Tokens live in the NextAuth `verification_tokens` table as a SHA-256 hash, so a
 * database read does not yield usable links. `identifier` is bound to the account id.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

const TTL_MS = 24 * 60 * 60 * 1000
const identifierFor = (userId: string) => `verify-email:${userId}`
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

/** Replaces any earlier link for the account and returns the raw token to email. */
export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex')
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: identifierFor(userId) } }),
    prisma.verificationToken.create({
      data: { identifier: identifierFor(userId), token: hash(token), expires: new Date(Date.now() + TTL_MS) },
    }),
  ])
  return token
}

/** Consumes the token (single use) and returns the account it was issued for. */
export async function consumeEmailVerificationToken(token: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  // deleteMany so that of two simultaneous clicks only one gets count 1.
  const record = await prisma.verificationToken.findUnique({ where: { token: hash(token) } })
  if (!record || !record.identifier.startsWith('verify-email:')) return null
  const deleted = await prisma.verificationToken.deleteMany({ where: { token: record.token } })
  if (deleted.count !== 1 || record.expires < new Date()) return null
  return record.identifier.slice('verify-email:'.length)
}
