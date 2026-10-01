/**
 * Resolving a team member's bio against their own account.
 *
 * `TeamMember` (admin-managed, /admin/team) and `User` (the person's account) are
 * separate tables with no foreign key between them. They are matched on email, so
 * a person who edits their bio at /profile?tab=account sees that bio on their
 * Meet the Team card without an admin re-typing it.
 *
 * Precedence: the account bio wins when there is one; the admin-entered bio is the
 * fallback for members with no account, or whose account bio is empty. An admin
 * therefore keeps a working bio for every member, and a member can override their
 * own at any time.
 */

import type { MemberTeam } from '@/lib/teamHierarchy'

export interface TeamMemberRow {
  id: string
  name: string
  role: string
  bio: string | null
  image: string | null
  email: string | null
  /** Masthead sort position; carried through so `buildTeamMasthead` can tier. */
  order: number
}

export interface LinkedAccount {
  email: string
  bio: string | null
  slug: string | null
}

export interface ResolvedTeamMember extends Omit<TeamMemberRow, 'role'> {
  role: string | null
  authorSlug: string | null
}

/** Emails to look up for a set of team members, lower-cased and de-duplicated. */
export function teamMemberEmails(members: TeamMemberRow[]): string[] {
  const emails = members
    .map((member) => member.email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email))
  return [...new Set(emails)]
}

/**
 * Merges account data into team member rows.
 *
 * Matching is case-insensitive on email, because a team email entered in the
 * admin form ("J.Smith@ed.ac.uk") frequently differs in case from the one the
 * person signed up with.
 */
export function resolveTeamMemberBios(
  members: TeamMemberRow[],
  accounts: LinkedAccount[],
): ResolvedTeamMember[] {
  const byEmail = new Map(
    accounts.map((account) => [account.email.trim().toLowerCase(), account]),
  )

  return members.map((member) => {
    const key = member.email?.trim().toLowerCase()
    const account = key ? byEmail.get(key) : undefined
    // An account with a blank bio falls back to the admin-entered one rather than
    // blanking the card — an empty self-bio is an absence, not a deletion.
    const accountBio = account?.bio?.trim() || null

    return {
      ...member,
      bio: accountBio ?? member.bio,
      authorSlug: account?.slug ?? null,
    }
  })
}

// ── Account-linked profiles ──────────────────────────────────────────────────
//
// A member can own one card, created from their portal. It is tied to their
// account by `TeamMember.userId` (unique), and its team is NEVER stored or taken
// from a request: it is derived from the account's role by `teamForRole`.

/** Roles that may own a team profile. ADMIN and READER have none. */
export const TEAM_PROFILE_ROLES = ['WRITER', 'EDITOR', 'GROWTH'] as const
type TeamProfileRole = (typeof TEAM_PROFILE_ROLES)[number]

const ROLE_TEAM: Record<TeamProfileRole, MemberTeam> = {
  WRITER: 'writing',
  EDITOR: 'editorial',
  GROWTH: 'growth',
}

export const TEAM_LABEL: Record<MemberTeam, string> = {
  writing: 'Writing',
  editorial: 'Editorial',
  growth: 'Growth & Communications',
}

/** The fixed role → team mapping. `null` means the role cannot own a profile. */
export function teamForRole(role: string | null | undefined): MemberTeam | null {
  return typeof role === 'string' && Object.hasOwn(ROLE_TEAM, role)
    ? ROLE_TEAM[role as TeamProfileRole]
    : null
}

export type BioResult = { ok: true; bio: string | null } | { ok: false; error: string }

/**
 * Trims a submitted bio and enforces the length cap. Empty means "no bio". Bios
 * are plain text and rendered through React, never as HTML, so no sanitising is
 * needed here — only a bound on size.
 */
export function validateTeamBio(value: unknown, maxLength: number): BioResult {
  if (value === undefined || value === null) return { ok: true, bio: null }
  if (typeof value !== 'string') return { ok: false, error: 'bio must be a string' }
  const bio = value.trim()
  if (bio.length > maxLength) {
    return { ok: false, error: `Your description must be ${maxLength} characters or fewer.` }
  }
  return { ok: true, bio: bio || null }
}

/** A team row together with the account it is linked to, if any. */
export interface TeamRowWithAccount extends TeamMemberRow {
  user: {
    email: string
    name: string | null
    role: string
    bio: string | null
    slug: string | null
    isActive: boolean
    isBanned: boolean
  } | null
}

export interface RosterMember extends ResolvedTeamMember {
  team: MemberTeam | null
}

/**
 * Builds the public roster from every active team row.
 *
 * - Linked card: shown only while its account is active, not banned and still in
 *   a team role (WRITER / EDITOR / GROWTH). The name comes from the account, so a rename is reflected
 *   without touching the card. The card's own bio wins, falling back to the
 *   account bio. The team comes from the account's current role.
 * - Legacy card (no account link): the existing email-matched bio behaviour.
 * - A legacy card whose email belongs to an account that already has a linked
 *   card is dropped, so nobody can appear twice while old and new data coexist.
 */
export function buildPublicRoster(
  rows: TeamRowWithAccount[],
  emailAccounts: LinkedAccount[],
): RosterMember[] {
  const linkedEmails = new Set<string>()
  const roster: RosterMember[] = []
  const legacy: TeamMemberRow[] = []

  for (const { user, ...row } of rows) {
    if (!user) {
      legacy.push(row)
      continue
    }
    linkedEmails.add(user.email.trim().toLowerCase())
    if (!user.isActive || user.isBanned) continue
    // Internal test accounts (the sitemap and author pages exclude them too) must
    // never surface publicly, even if one of them creates a card.
    if (isTestAccountEmail(user.email)) continue
    // The team is the account's role. No role-derived team (ADMIN, READER, or a
    // demoted account) means no public card: there is no exception for titles.
    const team = teamForRole(user.role)
    if (!team) continue
    roster.push({
      ...row,
      name: user.name?.trim() || row.name,
      role: row.role.trim() || null,
      bio: row.bio?.trim() || user.bio?.trim() || null,
      authorSlug: user.slug,
      team,
    })
  }

  const unlinked = legacy.filter((row) => {
    const email = row.email?.trim().toLowerCase()
    return !email || !linkedEmails.has(email)
  })
  for (const member of resolveTeamMemberBios(unlinked, emailAccounts)) {
    roster.push({ ...member, team: null })
  }
  return roster
}

/** Accounts created for testing; excluded from every public listing. */
function isTestAccountEmail(email: string): boolean {
  return email.trim().toLowerCase().startsWith('test-')
}

/**
 * Case- and whitespace-insensitive form of a name. Used ONLY to refuse creating a
 * second card for someone who may already have one — never to link or adopt a
 * card. A name is user-editable, so letting it grant ownership would let anyone
 * rename their account and take over somebody else's card.
 */
export function normalizePersonName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}
