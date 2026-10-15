/**
 * Editorial hierarchy for the public masthead (`/team`).
 *
 * `TeamMember.role` is a free-text column that admins edit through
 * /admin/team, so the public page cannot rely on a fixed enum. This module maps
 * whatever string was typed onto a small ordered set of tiers, then groups the
 * roster into the sections the masthead renders. It is deliberately tolerant:
 * casing, punctuation, unfamiliar titles and missing roles all resolve to
 * something sensible rather than throwing or dropping a person off the page.
 * An untitled member defaults to Wider Team unless an admin assigns publicTier.
 *
 * Adding a person through the admin UI therefore places them automatically —
 * no code change is needed for a new writer, editor or ops role.
 */

/** Ordered from the top of the masthead downwards. */
export type TeamTierId =
  | 'editor_in_chief'
  | 'deputy'
  | 'leadership'
  | 'editor'
  | 'writer'
  | 'growth'
  | 'other'

/** Card prominence. The masthead narrows as it descends. */
export type TeamCardVariant = 'lead' | 'feature' | 'standard' | 'compact'

export type TeamSectionId = 'masthead' | 'editorial' | 'writers' | 'growth' | 'wider'

/** Labels for ordinary new-member defaults. Not account permissions. */
export type MemberTeam = 'writing' | 'editorial' | 'growth'

/** Minimal shape the hierarchy needs; the Prisma `TeamMember` satisfies it. */
export interface TeamMemberLike {
  id: string
  name: string
  role: string | null
  order: number
  /** Optional name used only to order cards that share a tier (stable, case-insensitive). */
  placementName?: string
  /** A label for ordinary new-member defaults. It never decides placement. */
  team?: MemberTeam | null
  publicTier?: string | null
}

export interface TeamRow<T extends TeamMemberLike> {
  tier: TeamTierId
  variant: TeamCardVariant
  members: T[]
}

export interface TeamSection<T extends TeamMemberLike> {
  id: TeamSectionId
  /** Heading text. Always present for screen readers; see `labelVisible`. */
  label: string
  /** Whether the heading is drawn, or only exposed to assistive tech. */
  labelVisible: boolean
  rows: TeamRow<T>[]
}

const TIER_SECTION: Record<TeamTierId, TeamSectionId> = {
  editor_in_chief: 'masthead',
  deputy: 'masthead',
  leadership: 'masthead',
  editor: 'editorial',
  writer: 'writers',
  growth: 'growth',
  other: 'wider',
}

const TIER_VARIANT: Record<TeamTierId, TeamCardVariant> = {
  editor_in_chief: 'lead',
  deputy: 'feature',
  leadership: 'feature',
  editor: 'standard',
  writer: 'compact',
  growth: 'compact',
  other: 'compact',
}

/** Render order of the tiers, top of the masthead first. */
export const TEAM_TIER_ORDER: readonly TeamTierId[] = [
  'editor_in_chief',
  'deputy',
  'leadership',
  'editor',
  'writer',
  'growth',
  'other',
]

const SECTION_ORDER: readonly TeamSectionId[] = [
  'masthead',
  'editorial',
  'writers',
  'growth',
  'wider',
]

const SECTION_META: Record<TeamSectionId, { label: string; labelVisible: boolean }> = {
  // The two masthead rows read as a hierarchy on their own; a visible label
  // would only restate what the cards already say.
  masthead: { label: 'Masthead', labelVisible: false },
  editorial: { label: 'Editorial Team', labelVisible: true },
  writers: { label: 'Writers', labelVisible: true },
  growth: { label: 'Growth & Comms', labelVisible: true },
  wider: { label: 'Wider Team', labelVisible: true },
}

/**
 * True when a role string carries no information (null, empty, or whitespace).
 * A member in this state is rendered with no role line at all rather than a
 * placeholder.
 */
export function hasDisplayableRole(role: string | null | undefined): role is string {
  return typeof role === 'string' && role.trim().length > 0
}

/** Lowercased, punctuation-stripped role, e.g. `Editor-in-Chief` → `editor in chief`. */
function normalizeRole(role: string | null | undefined): string {
  return (role ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Maps a free-text role onto a tier.
 *
 * A member with no role at all falls to `other` (the Wider Team section): an
 * untitled person carries no evidence of seniority, so the page must not infer
 * any. Administrators can separately assign publicTier; names and account
 * permissions never establish a public appointment.
 */
export function resolveTeamTier(role: string | null | undefined): TeamTierId {
  const normalized = normalizeRole(role)
  if (!normalized) return 'other'

  const isDeputy = /\b(deputy|associate|assistant|vice|acting|former)\b/.test(normalized)

  if (/\beditor in chief\b/.test(normalized)) {
    return /\bdeputy\b/.test(normalized) ? 'deputy' : isDeputy ? 'leadership' : 'editor_in_chief'
  }
  // Trusted public Growth titles are flat, including specialist Growth leads.
  if (/\b(growth|comms|communications|social media|digital operations)\b/.test(normalized)) return 'growth'

  // "Chief Designer", "Head of Design", "Creative Director" — specialist leads.
  if (/\b(chief|head|director)\b/.test(normalized)) return 'leadership'

  if (/\beditor/.test(normalized)) {
    return 'editor'
  }

  if (/\b(writer|contributor|columnist|correspondent|journalist|reporter)/.test(normalized)) {
    return 'writer'
  }

  // Unknown titles remain visible in Wider Team for administrator review.
  return 'other'
}

/** Lowercased, whitespace-collapsed name, used only to order cards deterministically. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

interface Placement {
  section: TeamSectionId
  tier: TeamTierId
}

/**
 * Where a card is rendered. Public appointment and permission role are separate concepts:
 * nothing about the linked account's permissions decides a card's place. Precedence:
 *
 * 1. Explicit `publicTier`: admin-managed public placement. It always wins, and is the only
 *    way an untitled or legacy card is placed in a specific row (there is no name-based
 *    exception: a historical masthead position is data, not code).
 * 2. Otherwise the trusted title decides. Titles are admin-managed: the self-service profile
 *    API rejects a title, team, role or placement posted by the member, so a member cannot
 *    move themselves up the masthead.
 */
function placeMember(member: TeamMemberLike): Placement {
  const publicTier = normalizePublicTier(member.publicTier)
  const tier =
    publicTier && TEAM_TIER_ORDER.includes(publicTier as TeamTierId)
      ? (publicTier as TeamTierId)
      : resolveTeamTier(member.role)
  return { section: TIER_SECTION[tier], tier }
}

/** The public section a card appears in, by name, for admin feedback ("under Writers"). */
export function publicSectionLabel(member: { publicTier?: string | null; role: string }): string {
  return SECTION_META[placeMember({ id: '', name: '', order: 0, role: member.role, publicTier: member.publicTier }).section].label
}

/** Read old placements as Editor; new writes use the current tier options. */
export function normalizePublicTier(tier: string | null | undefined): string | null {
  return tier === 'senior_editor' || tier === 'junior_editor' ? 'editor' : tier ?? null
}

/** `order` asc, roleless members last within their tier, then name for stability. */
function compareMembers(a: TeamMemberLike, b: TeamMemberLike): number {
  const aHasRole = hasDisplayableRole(a.role) ? 0 : 1
  const bHasRole = hasDisplayableRole(b.role) ? 0 : 1
  if (aHasRole !== bHasRole) return aHasRole - bHasRole
  if (a.order !== b.order) return a.order - b.order
  return (
    normalizeName(a.placementName ?? a.name).localeCompare(normalizeName(b.placementName ?? b.name), 'en') ||
    a.id.localeCompare(b.id, 'en')
  )
}

/**
 * Groups a roster into masthead sections and rows.
 *
 * Only one Editor-in-Chief is ever shown at the top: if the data contains more
 * than one, the lowest `order` keeps the position and the rest drop to the
 * leadership row of their own section. Empty rows are omitted; the three ordinary team sections remain available.
 */
export function buildTeamMasthead<T extends TeamMemberLike>(members: T[]): TeamSection<T>[] {
  const buckets = new Map<string, T[]>()
  const key = (section: TeamSectionId, tier: TeamTierId) => `${section}:${tier}`
  const add = (section: TeamSectionId, tier: TeamTierId, member: T) => {
    const bucket = buckets.get(key(section, tier))
    if (bucket) bucket.push(member)
    else buckets.set(key(section, tier), [member])
  }

  const chiefs: { member: T; section: TeamSectionId }[] = []
  for (const member of members) {
    const { section, tier } = placeMember(member)
    if (tier === 'editor_in_chief') chiefs.push({ member, section })
    else add(section, tier, member)
  }

  chiefs.sort((a, b) => compareMembers(a.member, b.member))
  chiefs.forEach(({ member, section }, index) => {
    add(section, index === 0 ? 'editor_in_chief' : 'leadership', member)
  })

  for (const bucket of buckets.values()) bucket.sort(compareMembers)
  // Preserve additional appointments without crowding the two deputy cards.
  const deputies = buckets.get(key('masthead', 'deputy'))
  if (deputies && deputies.length > 2) {
    for (const member of deputies.splice(2)) add('editorial', 'leadership', member)
    buckets.get(key('editorial', 'leadership'))?.sort(compareMembers)
  }

  return SECTION_ORDER.flatMap<TeamSection<T>>((sectionId) => {
    const rows = TEAM_TIER_ORDER.map((tier) => ({
      tier,
      variant: TIER_VARIANT[tier],
      members: buckets.get(key(sectionId, tier)) ?? [],
    })).filter((row) => row.members.length > 0)

    if (rows.length === 0 && !['editorial', 'writers', 'growth'].includes(sectionId)) return []
    return [{ id: sectionId, ...SECTION_META[sectionId], rows }]
  })
}
