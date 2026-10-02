/**
 * Finding the legacy (admin-typed, unlinked) card that may already belong to an
 * account, so a person with an existing card edits it instead of getting a second.
 *
 * Deliberately conservative — it only ever resolves to one of three outcomes:
 *   - adoptable: exactly ONE unlinked card carries the account's email. The email
 *     is admin-entered on the card and unique on the account, so this is an
 *     unambiguous claim.
 *   - blocked:   the match is ambiguous (several cards share the email) or rests on
 *     a name only. A name can be edited by the account holder, so it can never
 *     grant ownership — but it is good evidence that a card exists, so creating a
 *     new one is refused until an admin links the right card.
 *   - none:      no sign of an existing card; safe to create.
 */
import type { prisma } from '@/lib/prisma'
import { normalizePersonName } from '@/lib/teamProfiles'

type Db = Pick<typeof prisma, 'teamMember'>

export type LegacyMatch =
  | { kind: 'adoptable'; card: { id: string; bio: string | null; image: string | null } }
  | { kind: 'blocked' }
  | { kind: 'none' }

export async function matchLegacyCard(
  db: Db,
  account: { name: string; email: string | null },
): Promise<LegacyMatch> {
  if (account.email) {
    const byEmail = await db.teamMember.findMany({
      where: { userId: null, email: { equals: account.email.trim(), mode: 'insensitive' } },
      select: { id: true, bio: true, image: true },
      take: 2,
    })
    if (byEmail.length === 1) return { kind: 'adoptable', card: byEmail[0] }
    if (byEmail.length > 1) return { kind: 'blocked' }
  }

  const byName = await db.teamMember.findMany({
    where: { userId: null, name: { equals: account.name.trim(), mode: 'insensitive' } },
    select: { name: true },
  })
  // The database comparison is case-insensitive only; re-check whitespace and
  // Unicode normalisation in code.
  const wanted = normalizePersonName(account.name)
  const nameClash = byName.some((card) => normalizePersonName(card.name) === wanted)
  if (nameClash) return { kind: 'blocked' }

  // A card whose stored name has odd internal spacing is not caught by `equals`;
  // sweep the (small) set of unlinked cards for it. The roster is tens of rows.
  const unlinked = await db.teamMember.findMany({ where: { userId: null }, select: { name: true } })
  return unlinked.some((card) => normalizePersonName(card.name) === wanted)
    ? { kind: 'blocked' }
    : { kind: 'none' }
}
