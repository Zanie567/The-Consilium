/**
 * Permissions belong to User, ownership to the unique TeamMember.userId link,
 * and public appointment to the admin-managed card title/publicTier/order.
 * Linked cards prefer their own description, then account bio. Legacy cards
 * retain the case-insensitive email bio fallback until safely linked.
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
  publicTier?: string | null
  isActive?: boolean
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
// Ownership is unique; appointment and placement are trusted card data.
export const TEAM_PROFILE_ROLES = ['ADMIN', 'WRITER', 'EDITOR', 'GROWTH'] as const
type TeamProfileRole = (typeof TEAM_PROFILE_ROLES)[number]

const ROLE_TEAM: Partial<Record<TeamProfileRole, MemberTeam>> = {
  WRITER: 'writing',
  EDITOR: 'editorial',
  GROWTH: 'growth',
}

export const TEAM_LABEL: Record<MemberTeam, string> = {
  writing: 'Writing',
  editorial: 'Editorial',
  growth: 'Growth & Communications',
}

/** Ordinary creation defaults only. ADMIN never gets a card automatically. */
export function teamForRole(role: string | null | undefined): MemberTeam | null {
  return typeof role === 'string' && Object.hasOwn(ROLE_TEAM, role)
    ? ROLE_TEAM[role as TeamProfileRole] ?? null
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
  placementName?: string
  team: MemberTeam | null
}

/** Public placement comes from the card; permissions never choose its section. */
export function buildPublicRoster(
  rows: TeamRowWithAccount[],
  emailAccounts: LinkedAccount[],
): RosterMember[] {
  const linkedEmails = new Set<string>()
  const roster: RosterMember[] = []
  const legacy: TeamMemberRow[] = []

  for (const { user, ...card } of rows) {
    // Explicit public projection: Prisma rows contain internal ownership fields.
    const row: TeamMemberRow = { id: card.id, name: card.name, role: card.role, bio: card.bio,
      image: card.image, email: card.email, order: card.order, publicTier: card.publicTier, isActive: card.isActive }
    if (row.isActive === false) continue
    if (!user) {
      legacy.push(row)
      continue
    }
    linkedEmails.add(user.email.trim().toLowerCase())
    if (!user.isActive || user.isBanned) continue
    // Internal test accounts (the sitemap and author pages exclude them too) must
    // never surface publicly, even if one of them creates a card.
    if (isTestAccountEmail(user.email) && process.env.TESTING_MODE_ENABLED !== '1') continue
    roster.push({
      ...row,
      name: user.name?.trim() || row.name,
      placementName: row.name,
      role: row.role.trim() || null,
      bio: row.bio?.trim() || user.bio?.trim() || null,
      authorSlug: user.slug,
      team: null,
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

/** Used only when an ordinary member creates a new card. Never on update. */
export function defaultPublicAppointment(role: string) {
  return ({ WRITER: { role: 'Writer', publicTier: 'writer' },
    EDITOR: { role: 'Editor', publicTier: 'editor' },
    GROWTH: { role: 'Growth & Communications', publicTier: 'growth' } } as const)[role as 'WRITER' | 'EDITOR' | 'GROWTH'] ?? null
}
export function publicAppointmentLabel(card: { role?: string | null; publicTier?: string | null }) {
  return card.role?.trim() || ({ editor_in_chief: 'Editor-in-Chief', leadership: 'Leadership', senior_editor: 'Senior Editor', editor: 'Editor', junior_editor: 'Junior Editor', writer: 'Writer', growth: 'Growth & Communications', other: 'Wider Team' } as Record<string, string>)[card.publicTier ?? 'other'] || 'Wider Team'
}
