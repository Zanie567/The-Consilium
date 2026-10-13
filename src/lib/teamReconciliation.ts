/**
 * Read-only consistency report across the three places a person lives:
 *   users (authentication + permission role), team_memberships (authorisation trail) and
 *   team_members (the public Meet the Team card).
 *
 * It never changes anything. Each finding says what looks wrong and, where one exists, which
 * records are involved, so an administrator reviews it and uses the explicit link/unlink
 * actions. Identity is never guessed: an email match is offered as a likely owner, a name
 * match only as a hint, and several candidates are reported as ambiguous.
 */
import { normalizePersonName } from '@/lib/teamProfiles'

export interface ReportAccount {
  id: string
  email: string
  name: string | null
  role: string
  isActive: boolean
  isBanned: boolean
}
export interface ReportCard {
  id: string
  name: string
  position: string
  email: string | null
  userId: string | null
  visible: boolean
}
export interface ReportMembership {
  id: string
  email: string
  role: string
  status: 'PENDING' | 'ACTIVE' | 'REVOKED'
  userId: string | null
}

export type IssueKind =
  | 'unlinked-card-matches-account'
  | 'unlinked-card-ambiguous'
  | 'staff-without-profile'
  | 'duplicate-profile-name'
  | 'linked-account-not-eligible'
  | 'possible-mislink'
  | 'role-drift'
  | 'admin-without-profile'

export interface ReconciliationIssue {
  kind: IssueKind
  severity: 'review' | 'info'
  message: string
  cardIds: string[]
  accountIds: string[]
}

const STAFF = new Set(['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'])
const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export function buildReconciliationReport(input: {
  accounts: ReportAccount[]
  cards: ReportCard[]
  memberships: ReportMembership[]
}): ReconciliationIssue[] {
  const { accounts, cards, memberships } = input
  const issues: ReconciliationIssue[] = []
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const accountsByEmail = new Map<string, ReportAccount[]>()
  for (const a of accounts) {
    const key = lower(a.email)
    accountsByEmail.set(key, [...(accountsByEmail.get(key) ?? []), a])
  }
  const linkedUserIds = new Set(cards.filter((c) => c.userId).map((c) => c.userId as string))
  const unlinked = cards.filter((c) => !c.userId)

  // 1. Unlinked cards whose email points at an account.
  for (const card of unlinked) {
    const matches = card.email ? (accountsByEmail.get(lower(card.email)) ?? []) : []
    const free = matches.filter((a) => !linkedUserIds.has(a.id))
    if (matches.length === 1 && free.length === 1) {
      issues.push({
        kind: 'unlinked-card-matches-account',
        severity: 'review',
        message: `"${card.name}" is not linked, but its email matches the account ${free[0].email}. Review and link it if that is the same person.`,
        cardIds: [card.id],
        accountIds: [free[0].id],
      })
    } else if (matches.length > 1) {
      issues.push({
        kind: 'unlinked-card-ambiguous',
        severity: 'review',
        message: `"${card.name}" is not linked and its email matches ${matches.length} accounts. Choose the right one by hand.`,
        cardIds: [card.id],
        accountIds: matches.map((a) => a.id),
      })
    }
  }

  // 2. Staff accounts with no card (admins are informational: a public card is optional for them).
  for (const account of accounts) {
    if (!STAFF.has(account.role) || !account.isActive || account.isBanned || linkedUserIds.has(account.id)) continue
    const candidates = unlinked.filter(
      (c) => lower(c.email) === lower(account.email) || (account.name && normalizePersonName(c.name) === normalizePersonName(account.name)),
    )
    const hint = candidates.length
      ? ` Possible existing profile${candidates.length > 1 ? 's' : ''}: ${candidates.map((c) => `"${c.name}"`).join(', ')}.`
      : ''
    issues.push({
      kind: account.role === 'ADMIN' ? 'admin-without-profile' : 'staff-without-profile',
      // An administrator needs no public card, so that alone is only informational. But an
      // existing unlinked card that looks like theirs (for example the Editor-in-Chief card)
      // is worth a human look: it is probably theirs and simply was never linked.
      severity: account.role === 'ADMIN' && candidates.length === 0 ? 'info' : 'review',
      message: `${account.email} (${account.role.toLowerCase()}) has no public profile.${hint}`,
      cardIds: candidates.map((c) => c.id),
      accountIds: [account.id],
    })
  }

  // 3. Two cards with the same person name.
  const byName = new Map<string, ReportCard[]>()
  for (const card of cards) {
    const key = normalizePersonName(card.name)
    byName.set(key, [...(byName.get(key) ?? []), card])
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue
    issues.push({
      kind: 'duplicate-profile-name',
      severity: 'review',
      message: `${group.length} profiles share the name "${group[0].name}". Keep one, or confirm they are different people.`,
      cardIds: group.map((c) => c.id),
      accountIds: group.flatMap((c) => (c.userId ? [c.userId] : [])),
    })
  }

  // 4. Linked cards whose owner cannot currently be a team member.
  for (const card of cards) {
    if (!card.userId) continue
    const owner = accountById.get(card.userId)
    if (!owner) continue
    if (!owner.isActive || owner.isBanned || !STAFF.has(owner.role)) {
      issues.push({
        kind: 'linked-account-not-eligible',
        severity: 'review',
        message: `"${card.name}" is linked to ${owner.email}, which is ${!owner.isActive ? 'inactive' : owner.isBanned ? 'suspended' : 'not a team account'}. The card is not shown publicly${card.visible ? ' although it is marked visible' : ''}.`,
        cardIds: [card.id],
        accountIds: [owner.id],
      })
    }
    // 5. A card email that belongs to somebody else suggests it was linked to the wrong account.
    if (card.email && lower(card.email) !== lower(owner.email)) {
      const other = (accountsByEmail.get(lower(card.email)) ?? []).find((a) => a.id !== owner.id)
      if (other) {
        issues.push({
          kind: 'possible-mislink',
          severity: 'review',
          message: `"${card.name}" is linked to ${owner.email} but its email is ${card.email}, which is a different account. It may be linked to the wrong person.`,
          cardIds: [card.id],
          accountIds: [owner.id, other.id],
        })
      }
    }
  }

  // 6. The permission role on the membership trail and on the account disagree.
  for (const membership of memberships) {
    if (membership.status !== 'ACTIVE' || !membership.userId) continue
    const account = accountById.get(membership.userId)
    if (account && account.role !== membership.role) {
      issues.push({
        kind: 'role-drift',
        severity: 'review',
        message: `${account.email} has the ${account.role.toLowerCase()} role, but the member record says ${membership.role.toLowerCase()}. Re-apply the role from Team Members to bring them back in line.`,
        cardIds: [],
        accountIds: [account.id],
      })
    }
  }

  const rank = { review: 0, info: 1 } as const
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity])
}
