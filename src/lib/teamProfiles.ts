/**
 * Permissions belong to User, ownership to the unique TeamMember.userId link,
 * and public appointment to the admin-managed card title/publicTier/order.
 * Linked cards prefer their own description, then account bio. Legacy cards
 * retain the case-insensitive email bio fallback until safely linked.
 */

import { normalizePublicTier, type MemberTeam } from '@/lib/teamHierarchy'
import { normalizePublicPosition, resolvePublicTitleLabel } from '@/lib/displayTitles'
import { publicationBlockers } from '@/lib/teamVisibility'

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
  id: string
  email: string
  bio: string | null
  slug: string | null
}

/**
 * The account a card's articles are attributed to: the card's own linked account, or an
 * unambiguous legacy email match. Server-side only — it carries the account id, which the
 * public page receives (as an author-page link) only once the account has published.
 */
export interface AuthorIdentity {
  id: string
  slug: string | null
}

/** A public author page. `/author/[slug]` resolves a stored slug first, then an account id. */
export type AuthorPageHref = `/author/${string}`

export function authorPageHref(author: AuthorIdentity): AuthorPageHref {
  return `/author/${encodeURIComponent(author.slug || author.id)}`
}

export interface ResolvedTeamMember extends Omit<TeamMemberRow, 'role'> {
  role: string | null
  /** Display titles, or the role fallback. Printed only; never used for placement. */
  titleLabel?: string | null
  author: AuthorIdentity | null
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
 *
 * Articles are attributed only when the match is unambiguous: exactly one account
 * and exactly one of these cards share the address. Two accounts differing only in
 * case, or a shared address on two cards, attribute nothing rather than guess.
 */
export function resolveTeamMemberBios(
  members: TeamMemberRow[],
  accounts: LinkedAccount[],
): ResolvedTeamMember[] {
  const normalise = (email: string) => email.trim().toLowerCase()
  const byEmail = new Map(accounts.map((account) => [normalise(account.email), account]))
  const tally = (emails: string[]) =>
    emails.reduce((counts, email) => counts.set(email, (counts.get(email) ?? 0) + 1), new Map<string, number>())
  const accountsPerEmail = tally(accounts.map((account) => normalise(account.email)))
  const cardsPerEmail = tally(members.flatMap((member) => (member.email ? [normalise(member.email)] : [])))

  return members.map((member) => {
    const key = member.email?.trim().toLowerCase()
    const account = key ? byEmail.get(key) : undefined
    const unambiguous = Boolean(key && accountsPerEmail.get(key) === 1 && cardsPerEmail.get(key) === 1)
    // An account with a blank bio falls back to the admin-entered one rather than
    // blanking the card — an empty self-bio is an absence, not a deletion.
    const accountBio = account?.bio?.trim() || null

    return {
      ...member,
      role: normalizePublicPosition(member.role),
      publicTier: normalizePublicTier(member.publicTier),
      bio: accountBio ?? member.bio,
      author: account && unambiguous ? { id: account.id, slug: account.slug } : null,
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
    id: string
    email: string
    name: string | null
    role: string
    displayTitles?: string[]
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

/** A Meet the Team card as published. Carries no account id unless it links to an author page. */
export interface PublicRosterMember extends Omit<RosterMember, 'author'> {
  /**
   * Set exactly when this person's own account has at least one publicly visible article
   * (`publishedArticleWhere`). Role, title, placement and permissions play no part.
   */
  authorPage: AuthorPageHref | null
}

/** Distinct accounts whose publication status decides the roster's author links. */
export function rosterAuthorIds(roster: RosterMember[]): string[] {
  return [...new Set(roster.flatMap((member) => (member.author ? [member.author.id] : [])))]
}

/** Replaces each internal author identity with a public author link, or none. */
export function attachAuthorPages(
  roster: RosterMember[],
  publishedAuthorIds: ReadonlySet<string>,
): PublicRosterMember[] {
  return roster.map(({ author, ...member }) => ({
    ...member,
    authorPage: author && publishedAuthorIds.has(author.id) ? authorPageHref(author) : null,
  }))
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
    const row: TeamMemberRow = { id: card.id, name: card.name, role: normalizePublicPosition(card.role), bio: card.bio,
      image: card.image, email: card.email, order: card.order, publicTier: normalizePublicTier(card.publicTier), isActive: card.isActive }
    if (row.isActive === false) continue
    if (!user) {
      legacy.push(row)
      continue
    }
    linkedEmails.add(user.email.trim().toLowerCase())
    // A linked card must say who the person is, what they do and a little about them, and its
    // account must be active, unsuspended and not an internal test account. Anything less is
    // "not ready", never a half-empty public card ("Unknown User", "No Role"). The single rule
    // lives in teamVisibility.ts so the admin screen explains exactly what this enforces.
    if (publicationBlockers({ name: row.name, position: row.role, bio: row.bio }, user, { testingMode: process.env.TESTING_MODE_ENABLED === '1' }).length > 0) continue
    const name = row.name.trim() || user.name!.trim()
    const position = row.role.trim()
    const bio = row.bio!.trim()
    roster.push({
      ...row,
      name,
      placementName: row.name,
      role: position,
      titleLabel: resolvePublicTitleLabel({ displayTitles: user.displayTitles, cardTitle: row.role }),
      bio,
      author: { id: user.id, slug: user.slug },
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
  return (card.role ? normalizePublicPosition(card.role) : '') || ({ editor_in_chief: 'Editor-in-Chief', deputy: 'Deputy Editor-in-Chief', leadership: 'Leadership', senior_editor: 'Editor', editor: 'Editor', junior_editor: 'Editor', writer: 'Writer', growth: 'Growth & Communications', other: 'Wider Team' } as Record<string, string>)[card.publicTier ?? 'other'] || 'Wider Team'
}

/** Public author labels follow the same owned, visible appointment as the masthead. */
export function visiblePublicAppointmentLabel(account: {
  isActive: boolean
  isBanned: boolean
  teamProfile: { role: string; publicTier?: string | null; isActive: boolean } | null
}): string | null {
  if (!account.isActive || account.isBanned || !account.teamProfile?.isActive) return null
  return publicAppointmentLabel(account.teamProfile)
}

/**
 * The title line on a public author page. Display titles win, then the visible team
 * card's title; the caller prints "Contributor" when this is null. The permission
 * role is never used. A banned or deactivated account shows nothing, and an
 * inactive card never contributes its title.
 */
export function visiblePublicTitleLabel(account: {
  isActive: boolean
  isBanned: boolean
  displayTitles?: unknown
  teamProfile: { role: string; publicTier?: string | null; isActive: boolean } | null
}): string | null {
  if (!account.isActive || account.isBanned) return null
  return resolvePublicTitleLabel({
    displayTitles: account.displayTitles,
    cardTitle: account.teamProfile?.isActive ? publicAppointmentLabel(account.teamProfile) : null,
  })
}

// ── Completeness ─────────────────────────────────────────────────────────────

export interface ProfileFacts {
  name: string | null | undefined
  bio: string | null | undefined
  image: string | null | undefined
  /** The public title (`TeamMember.role`). Admin-managed. */
  position: string | null | undefined
  /** Admin-controlled visibility switch (`TeamMember.isActive`). */
  visible: boolean
}

export interface ProfileAssessment {
  /** What the member can still supply themselves. */
  missingFromMember: ('name' | 'bio' | 'photo')[]
  /** What only an administrator can supply. */
  missingFromAdmin: 'position'[]
  /** Everything above is present. */
  complete: boolean
  /** Why the card is not on the public page; empty when it is. */
  publicBlockers: ('name' | 'bio' | 'position' | 'hidden')[]
  publiclyVisible: boolean
}

const filled = (value: string | null | undefined) => typeof value === 'string' && value.trim().length > 0

/**
 * Single definition of "complete" and "publishable". A photo is encouraged (it is part
 * of "complete") but not required to appear: the card draws initials without one.
 * Name, description and position are required, so "Unknown User", "No Name" or a card
 * with no role can never be shown. Placement (`publicTier`) is optional: without one
 * the title decides, as on `main`.
 */
export function assessProfile(facts: ProfileFacts): ProfileAssessment {
  const missingFromMember: ProfileAssessment['missingFromMember'] = []
  if (!filled(facts.name)) missingFromMember.push('name')
  if (!filled(facts.bio)) missingFromMember.push('bio')
  if (!filled(facts.image)) missingFromMember.push('photo')

  const missingFromAdmin: ProfileAssessment['missingFromAdmin'] = []
  if (!filled(facts.position)) missingFromAdmin.push('position')

  const publicBlockers: ProfileAssessment['publicBlockers'] = []
  if (!filled(facts.name)) publicBlockers.push('name')
  if (!filled(facts.bio)) publicBlockers.push('bio')
  if (!filled(facts.position)) publicBlockers.push('position')
  if (!facts.visible) publicBlockers.push('hidden')

  return {
    missingFromMember,
    missingFromAdmin,
    complete: missingFromMember.length === 0 && missingFromAdmin.length === 0,
    publicBlockers,
    publiclyVisible: publicBlockers.length === 0,
  }
}
