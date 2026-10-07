/**
 * Member onboarding: pre-authorised memberships, first-login claiming, role changes
 * and revocation.
 *
 * Two concepts stay separate throughout:
 *   - AUTHORISATION  `User.role` (+ `TeamMembership.role`): what the account may do.
 *   - PUBLIC POSITION `TeamMember.role` / `.publicTier`: what the Meet the Team card says.
 * Nothing here ever derives one from the other after the card exists.
 *
 * Authority comes ONLY from:
 *   1. an admin action (invite / set role / revoke), enforced by the admin-only
 *      routes that call into this module, or
 *   2. `claimInvitationForUser`, which an account can only trigger for ITSELF, using
 *      the email address stored on its own database row, and only once that address
 *      is verified (Google `email_verified`, an emailed link, or a password reset).
 * No function here accepts a role from a member or from a request body.
 *
 * `User.role` stays the value every existing access gate reads, so this module adds
 * the audit trail and the pre-authorisation without touching any of those gates.
 */
import type { Prisma, Role, MembershipStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueViolation } from '@/lib/prismaErrors'
import { matchLegacyCard } from '@/lib/teamProfileLegacy'
import { assessProfile as assessProfileFacts, defaultPublicAppointment } from '@/lib/teamProfiles'
import { TEAM_TIER_ORDER } from '@/lib/teamHierarchy'

type Tx = Prisma.TransactionClient

/** Roles an admin may grant. READER is the absence of membership, not a grant. */
export const ASSIGNABLE_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'] as const satisfies readonly Role[]
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value)
}

/** Where a brand-new card sits among the admin-ordered ones: after them. */
export const NEW_CARD_ORDER = 1000
export const MAX_POSITION_LENGTH = 100
const MAX_DISPLAY_NAME_LENGTH = 100
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The canonical form of an email for matching. Case and surrounding space never matter. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email)
}

/** Typed failure the routes turn into an HTTP status. */
export class MembershipError extends Error {
  constructor(
    readonly code:
      | 'INVALID_EMAIL'
      | 'INVALID_ROLE'
      | 'INVALID_FIELD'
      | 'ALREADY_MEMBER'
      | 'NOT_FOUND'
      | 'SELF_CHANGE'
      | 'LAST_ADMIN'
      | 'NOT_REVOKED'
      | 'NO_PROFILE',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export interface Actor {
  id: string
  name: string | null
  email: string | null
}

const actorLabel = (actor: Actor) => actor.name ?? actor.email ?? actor.id

// ── Audit ────────────────────────────────────────────────────────────────────

/** Written inside the caller's transaction, so a change and its audit row commit together. */
async function audit(
  tx: Tx,
  action: string,
  targetId: string,
  performedBy: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: { action, targetId, targetType: 'user', performedBy, metadata },
  })
}

/** Actor id recorded for changes no admin made (the member claiming their own invitation). */
const SYSTEM_ACTOR = 'system:invitation-claim'

// ── Team card ────────────────────────────────────────────────────────────────

interface CardOptions {
  /** The account's permission role: only used to pick the ordinary new-member default title. */
  role?: string
  /** Admin-chosen public title / placement; override the ordinary defaults. */
  position?: string | null
  publicTier?: string | null
  displayName?: string | null
}

/**
 * Makes sure the account has ONE Meet the Team card, without ever overwriting one.
 *
 * - Existing card for the account: returned untouched (no reset of name, bio, photo,
 *   position, placement, order or visibility).
 * - Exactly one unlinked legacy card with the account's email: adopted, again
 *   untouched except for linking it.
 * - A doubtful legacy match (ambiguous email, or same name): NO card is created, so
 *   nobody appears twice; an admin links the right one.
 * - Otherwise a new card, HIDDEN until an administrator publishes it.
 *
 * The UNIQUE index on `userId` is the real duplicate guard; `skipDuplicates` makes a
 * concurrent create a no-op instead of an aborted transaction.
 */
export async function ensureProfileCard(
  tx: Tx,
  account: { id: string; name: string | null; email: string },
  options: CardOptions = {},
): Promise<{ id: string; created: boolean } | null> {
  const existing = await tx.teamMember.findUnique({ where: { userId: account.id }, select: { id: true } })
  if (existing) return { id: existing.id, created: false }

  const name = options.displayName?.trim() || account.name?.trim() || ''
  const match = await matchLegacyCard(tx, { name: name || account.email, email: account.email })
  if (match.kind === 'blocked') return null
  if (match.kind === 'adoptable') {
    const claimed = await tx.teamMember.updateMany({
      where: { id: match.card.id, userId: null },
      data: { userId: account.id },
    })
    if (claimed.count === 1) return { id: match.card.id, created: false }
  }

  // A card with no name is the "Unknown User" card; wait for the member to supply one.
  if (!name) return null

  // Ordinary members start with the default title/placement for their role (as on the
  // self-service path); an admin-supplied position or tier overrides it. ADMIN has no default.
  const appointment = options.role ? defaultPublicAppointment(options.role) : null
  const created = await tx.teamMember.createMany({
    data: [
      {
        userId: account.id,
        name,
        role: options.position?.trim() || appointment?.role || '',
        publicTier: options.publicTier ?? appointment?.publicTier ?? null,
        order: NEW_CARD_ORDER,
        isActive: false,
      },
    ],
    skipDuplicates: true,
  })
  const row = await tx.teamMember.findUnique({ where: { userId: account.id }, select: { id: true } })
  return row ? { id: row.id, created: created.count === 1 } : null
}

// ── Claiming ─────────────────────────────────────────────────────────────────

export type ClaimResult =
  | { claimed: true; role: Role }
  | { claimed: false; reason: 'no-user' | 'unverified' | 'inactive' | 'no-invitation' | 'raced' }

/**
 * Links `userId` to the PENDING membership for its own email and puts the assigned
 * role in force. Idempotent: it only ever acts on a PENDING row, so a repeated login
 * finds nothing to do and cannot duplicate or reset anything.
 *
 * Identity: the email comes from the account's database row, never from a request. The
 * caller passes only a user id it already authenticated. The account must hold a
 * VERIFIED email; otherwise anyone could register an unconfirmed address and receive
 * that person's role.
 */
export async function claimInvitationForUser(userId: string, client: typeof prisma = prisma): Promise<ClaimResult> {
  return client.$transaction((tx) => claimInTx(tx, userId))
}

async function claimInTx(tx: Tx, userId: string): Promise<ClaimResult> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, emailVerified: true, isActive: true, isBanned: true },
  })
  if (!user) return { claimed: false, reason: 'no-user' }
  if (!user.emailVerified) return { claimed: false, reason: 'unverified' }
  if (!user.isActive || user.isBanned) return { claimed: false, reason: 'inactive' }

  const membership = await tx.teamMembership.findUnique({ where: { email: normalizeEmail(user.email) } })
  if (!membership || membership.status !== 'PENDING') return { claimed: false, reason: 'no-invitation' }

  // The `status: 'PENDING'` filter makes the claim atomic: of two concurrent
  // sign-ins only one updates the row.
  const won = await tx.teamMembership.updateMany({
    where: { id: membership.id, status: 'PENDING' },
    data: { status: 'ACTIVE', userId: user.id, claimedAt: new Date() },
  })
  if (won.count !== 1) return { claimed: false, reason: 'raced' }

  await applyRole(tx, user, membership.role)
  if (defaultPublicAppointment(membership.role) || membership.publicTier || membership.publicPosition) {
    await ensureProfileCard(
      tx,
      { id: user.id, name: user.name, email: user.email },
      {
        role: membership.role,
        position: membership.publicPosition,
        publicTier: membership.publicTier,
        displayName: membership.displayName,
      },
    )
  }
  await audit(tx, 'MEMBER_CLAIMED', user.id, SYSTEM_ACTOR, {
    membershipId: membership.id,
    role: membership.role,
    previousRole: user.role,
    email: membership.email,
  })
  return { claimed: true, role: membership.role }
}

async function applyRole(tx: Tx, user: { id: string; role: Role }, role: Role) {
  if (user.role !== role) await tx.user.update({ where: { id: user.id }, data: { role } })
}

/**
 * Records that the account has proved control of its email address, then claims any
 * invitation waiting for it. Called ONLY after a real proof: Google `email_verified`,
 * a verification link, or a completed password reset.
 */
export async function verifyEmailAndClaim(userId: string, client: typeof prisma = prisma): Promise<ClaimResult> {
  await client.user.updateMany({ where: { id: userId, emailVerified: null }, data: { emailVerified: new Date() } })
  return claimInvitationForUser(userId, client)
}

// ── Invitations (admin) ──────────────────────────────────────────────────────

export interface InviteInput {
  email: string
  role: unknown
  displayName?: unknown
  position?: unknown
  publicTier?: unknown
}

export type InviteOutcome =
  | 'invited' // new PENDING invitation, nobody has claimed it yet
  | 'updated' // the PENDING invitation already existed; role/fields updated
  | 'reinvited' // a REVOKED invitation was re-opened
  | 'activated' // the person already had a verified account, so it applied immediately

export interface InviteResult {
  outcome: InviteOutcome
  membership: { id: string; email: string; role: Role; status: MembershipStatus; userId: string | null }
  /** True when an account with this email exists but its address is not verified yet. */
  accountExistsUnverified: boolean
}

function cleanText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new MembershipError('INVALID_FIELD', `${label} must be text.`, 400)
  const text = value.trim()
  if (text.length > max) throw new MembershipError('INVALID_FIELD', `${label} must be ${max} characters or fewer.`, 400)
  return text || null
}

function cleanTier(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !(TEAM_TIER_ORDER as readonly string[]).includes(value)) {
    throw new MembershipError('INVALID_FIELD', `publicTier must be one of ${TEAM_TIER_ORDER.join(', ')}.`, 400)
  }
  return value
}

/**
 * Pre-authorises an email for a role. Safe to call twice for the same person: the
 * unique email means a second call updates the one row instead of adding another.
 */
export async function inviteMember(actor: Actor, input: InviteInput, client: typeof prisma = prisma): Promise<InviteResult> {
  const email = normalizeEmail(typeof input.email === 'string' ? input.email : '')
  if (!isPlausibleEmail(email)) throw new MembershipError('INVALID_EMAIL', 'Enter a valid email address.', 400)
  if (!isAssignableRole(input.role)) {
    throw new MembershipError('INVALID_ROLE', 'Role must be one of ADMIN, EDITOR, WRITER or GROWTH.', 400)
  }
  const role = input.role
  const displayName = cleanText(input.displayName, MAX_DISPLAY_NAME_LENGTH, 'Name')
  const publicPosition = cleanText(input.position, MAX_POSITION_LENGTH, 'Position')
  const publicTier = cleanTier(input.publicTier)

  const attempt = () =>
    client.$transaction(async (tx) => {
      const existing = await tx.teamMembership.findUnique({ where: { email } })
      if (existing?.status === 'ACTIVE') {
        throw new MembershipError(
          'ALREADY_MEMBER',
          'That person is already a member. Change their role from the member list instead.',
          409,
        )
      }

      const fields = {
        role,
        displayName,
        publicPosition,
        publicTier,
        invitedById: actor.id,
        invitedByName: actorLabel(actor),
      }
      let outcome: InviteOutcome
      let membership
      if (existing) {
        outcome = existing.status === 'REVOKED' ? 'reinvited' : 'updated'
        membership = await tx.teamMembership.update({
          where: { id: existing.id },
          data: { ...fields, status: 'PENDING', userId: null, revokedAt: null, revokedById: null, claimedAt: null },
        })
      } else {
        outcome = 'invited'
        membership = await tx.teamMembership.create({ data: { email, ...fields } })
      }

      await audit(tx, 'MEMBER_INVITED', membership.id, actor.id, {
        email,
        role,
        outcome,
        position: publicPosition,
        publicTier,
      })

      // Hiring someone who already has an account: apply at once, but only if that
      // account's address is verified (see claimInvitationForUser).
      const account = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, emailVerified: true },
      })
      let accountExistsUnverified = false
      if (account) {
        const claim = await claimInTx(tx, account.id)
        if (claim.claimed) {
          outcome = 'activated'
          membership = await tx.teamMembership.findUniqueOrThrow({ where: { id: membership.id } })
        } else if (claim.reason === 'unverified') {
          accountExistsUnverified = true
        }
      }

      return {
        outcome,
        accountExistsUnverified,
        membership: {
          id: membership.id,
          email: membership.email,
          role: membership.role,
          status: membership.status,
          userId: membership.userId,
        },
      }
    })

  try {
    return await attempt()
  } catch (error) {
    // A concurrent invite for the same email created the row first; redo as an update.
    if (isUniqueViolation(error)) return attempt()
    throw error
  }
}

// ── Role changes / revocation (admin) ────────────────────────────────────────

/** A member with no other active admin to hand over to must not be demoted or revoked. */
async function assertNotLastAdmin(tx: Tx, userId: string) {
  const others = await tx.user.count({
    where: { role: 'ADMIN', isActive: true, isBanned: false, id: { not: userId } },
  })
  if (others === 0) throw new MembershipError('LAST_ADMIN', 'There must always be at least one administrator.', 409)
}

/**
 * Sets an existing account's authorisation role. Works for an account that was
 * registered long before it was hired, and for promotions/demotions. Setting READER
 * is a revocation. The Meet the Team card is never deleted or edited by a role change:
 * placement is card data (title / publicTier), not derived from permissions.
 */
export async function setMemberRole(
  actor: Actor,
  userId: string,
  role: Role,
  client: typeof prisma = prisma,
): Promise<{ oldRole: Role; newRole: Role }> {
  if (userId === actor.id) throw new MembershipError('SELF_CHANGE', 'You cannot change your own role.', 400)
  if (role !== 'READER' && !isAssignableRole(role)) {
    throw new MembershipError('INVALID_ROLE', 'Invalid role.', 400)
  }

  const run = () =>
    client.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true },
      })
      if (!user) throw new MembershipError('NOT_FOUND', 'User not found.', 404)
      const oldRole = user.role
      const email = normalizeEmail(user.email)

      if (oldRole === 'READER' && role === 'READER') return { oldRole, newRole: role }
      if (oldRole === 'ADMIN' && role !== 'ADMIN') await assertNotLastAdmin(tx, userId)
    
      if (role === 'READER') {
        await revokeInTx(tx, actor, user, { hideProfile: false })
        return { oldRole, newRole: role }
      }

      // The email is the identity link. Admin chose this account explicitly, so an
      // unverified address is acceptable here (unlike the open claim path).
      const membership = await tx.teamMembership.upsert({
        where: { email },
        create: {
          email,
          role,
          status: 'ACTIVE',
          userId: user.id,
          claimedAt: new Date(),
          invitedById: actor.id,
          invitedByName: actorLabel(actor),
        },
        update: { role, status: 'ACTIVE', userId: user.id, revokedAt: null, revokedById: null, claimedAt: new Date() },
      })
      await applyRole(tx, user, role)
      if (defaultPublicAppointment(role)) {
        await ensureProfileCard(tx, { id: user.id, name: user.name, email: user.email }, { role })
      }
      await audit(tx, 'USER_ROLE_CHANGED', user.id, actor.id, {
        oldRole,
        newRole: role,
        membershipId: membership.id,
        targetEmail: user.email,
        adminName: actorLabel(actor),
      })
      return { oldRole, newRole: role }
    })

  try {
    return await run()
  } catch (error) {
    if (isUniqueViolation(error)) return run()
    throw error
  }
}

async function revokeInTx(
  tx: Tx,
  actor: Actor,
  user: { id: string; email: string; role: Role },
  options: { hideProfile: boolean },
) {
  const email = normalizeEmail(user.email)
  const now = new Date()
  await tx.teamMembership.upsert({
    where: { email },
    create: {
      email,
      role: user.role === 'READER' ? 'WRITER' : user.role,
      status: 'REVOKED',
      userId: user.id,
      revokedAt: now,
      revokedById: actor.id,
      invitedById: actor.id,
      invitedByName: actorLabel(actor),
    },
    update: { status: 'REVOKED', revokedAt: now, revokedById: actor.id },
  })
  if (user.role !== 'READER') await tx.user.update({ where: { id: user.id }, data: { role: 'READER' } })

  // The card is NOT deleted: the admin keeps it on the page or hides it, as a separate decision.
  if (options.hideProfile) await tx.teamMember.updateMany({ where: { userId: user.id }, data: { isActive: false } })

  await audit(tx, 'MEMBER_REVOKED', user.id, actor.id, {
    previousRole: user.role,
    hideProfile: options.hideProfile,
    targetEmail: user.email,
  })
}

/**
 * Withdraws application access. Works on a pending invitation (cancels it) and on an
 * active account (back to READER). Profile data is never destroyed; whether the public
 * card stays is `hideProfile`, and can be changed independently afterwards.
 */
export async function revokeMember(
  actor: Actor,
  membershipId: string,
  options: { hideProfile?: boolean } = {},
  client: typeof prisma = prisma,
): Promise<{ status: 'REVOKED'; hadAccount: boolean }> {
  return client.$transaction(async (tx) => {
    const membership = await tx.teamMembership.findUnique({ where: { id: membershipId } })
    if (!membership) throw new MembershipError('NOT_FOUND', 'Member not found.', 404)
    if (membership.userId && membership.userId === actor.id) {
      throw new MembershipError('SELF_CHANGE', 'You cannot revoke your own access.', 400)
    }
    const user = membership.userId
      ? await tx.user.findUnique({ where: { id: membership.userId }, select: { id: true, email: true, role: true } })
      : null
    if (user) {
      if (user.role === 'ADMIN') await assertNotLastAdmin(tx, user.id)
      await revokeInTx(tx, actor, user, { hideProfile: options.hideProfile === true })
      return { status: 'REVOKED' as const, hadAccount: true }
    }
    await tx.teamMembership.update({
      where: { id: membership.id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedById: actor.id },
    })
    await audit(tx, 'MEMBER_REVOKED', membership.id, actor.id, { email: membership.email, pending: true })
    return { status: 'REVOKED' as const, hadAccount: false }
  })
}

/** Re-opens a revoked member with a role: immediately if they have an account, else as an invitation. */
export async function reinstateMember(
  actor: Actor,
  membershipId: string,
  role: unknown,
  client: typeof prisma = prisma,
): Promise<{ status: MembershipStatus }> {
  if (!isAssignableRole(role)) throw new MembershipError('INVALID_ROLE', 'Role must be one of ADMIN, EDITOR, WRITER or GROWTH.', 400)
  const membership = await client.teamMembership.findUnique({ where: { id: membershipId } })
  if (!membership) throw new MembershipError('NOT_FOUND', 'Member not found.', 404)
  if (membership.status !== 'REVOKED') throw new MembershipError('NOT_REVOKED', 'Only revoked members can be reinstated.', 409)

  if (membership.userId) {
    await setMemberRole(actor, membership.userId, role, client)
    return { status: 'ACTIVE' }
  }
  const result = await inviteMember(actor, { email: membership.email, role }, client)
  return { status: result.membership.status }
}

// ── Admin-controlled public fields ───────────────────────────────────────────

export interface ProfileFieldsInput {
  position?: unknown
  publicTier?: unknown
  order?: unknown
  visible?: unknown
  displayName?: unknown
}

/**
 * Admin-only edit of the public organisational fields. These are the ONLY writers of
 * `TeamMember.role` (position), `.publicTier`, `.order` and `.isActive` for linked cards;
 * the member-facing route cannot touch them.
 */
export async function updateMemberProfileFields(
  actor: Actor,
  membershipId: string,
  input: ProfileFieldsInput,
  client: typeof prisma = prisma,
): Promise<void> {
  const position = input.position === undefined ? undefined : (cleanText(input.position, MAX_POSITION_LENGTH, 'Position') ?? '')
  const publicTier = input.publicTier === undefined ? undefined : cleanTier(input.publicTier)
  const displayName = input.displayName === undefined ? undefined : cleanText(input.displayName, MAX_DISPLAY_NAME_LENGTH, 'Name')
  let order: number | undefined
  if (input.order !== undefined) {
    if (typeof input.order !== 'number' || !Number.isInteger(input.order) || input.order < 0 || input.order > 9999) {
      throw new MembershipError('INVALID_FIELD', 'Order must be a whole number from 0 to 9999.', 400)
    }
    order = input.order
  }
  let visible: boolean | undefined
  if (input.visible !== undefined) {
    if (typeof input.visible !== 'boolean') throw new MembershipError('INVALID_FIELD', 'visible must be true or false.', 400)
    visible = input.visible
  }

  await client.$transaction(async (tx) => {
    const membership = await tx.teamMembership.findUnique({ where: { id: membershipId } })
    if (!membership) throw new MembershipError('NOT_FOUND', 'Member not found.', 404)

    if (!membership.userId) {
      // No account yet: keep the starting values on the invitation; they seed the card at claim.
      if (order !== undefined || visible !== undefined) {
        throw new MembershipError('NO_PROFILE', 'Order and visibility apply once the person has an account.', 409)
      }
      await tx.teamMembership.update({
        where: { id: membership.id },
        data: {
          ...(position !== undefined ? { publicPosition: position || null } : {}),
          ...(publicTier !== undefined ? { publicTier } : {}),
          ...(displayName !== undefined ? { displayName } : {}),
        },
      })
      return
    }

    const user = await tx.user.findUniqueOrThrow({
      where: { id: membership.userId },
      select: { id: true, name: true, email: true, role: true },
    })
    // Create the card on demand (hidden) so an admin can prepare it before the member does.
    await ensureProfileCard(
      tx,
      { id: user.id, name: user.name, email: user.email },
      { role: user.role, displayName: displayName ?? undefined },
    )
    const card = await tx.teamMember.findUnique({ where: { userId: user.id }, select: { id: true } })
    if (!card) {
      throw new MembershipError(
        'NO_PROFILE',
        'An existing unlinked card may belong to this person. Link it from the Team page first.',
        409,
      )
    }
    await tx.teamMember.update({
      where: { id: card.id },
      data: {
        ...(position !== undefined ? { role: position } : {}),
        ...(publicTier !== undefined ? { publicTier } : {}),
        ...(displayName ? { name: displayName } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(visible !== undefined ? { isActive: visible } : {}),
      },
    })
    await audit(tx, 'MEMBER_PROFILE_ADMIN_EDIT', user.id, actor.id, {
      ...(position !== undefined ? { position } : {}),
      ...(publicTier !== undefined ? { publicTier } : {}),
      ...(order !== undefined ? { order } : {}),
      ...(visible !== undefined ? { visible } : {}),
    })
  })
}

// ── Admin directory ──────────────────────────────────────────────────────────

/** Prefix of the synthetic row id for staff accounts that pre-date memberships. */
export const ACCOUNT_REF_PREFIX = 'acct-'

/**
 * Resolves a member-list row id to a real membership id. Staff accounts created before
 * memberships existed show in the list under `acct-<userId>`; the first admin action on
 * one records its membership (ACTIVE, with the role it already has).
 */
export async function resolveMembershipId(idOrRef: string, client: typeof prisma = prisma): Promise<string | null> {
  if (!idOrRef.startsWith(ACCOUNT_REF_PREFIX)) {
    const found = await client.teamMembership.findUnique({ where: { id: idOrRef }, select: { id: true } })
    return found?.id ?? null
  }
  const userId = idOrRef.slice(ACCOUNT_REF_PREFIX.length)
  const user = await client.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } })
  if (!user || user.role === 'READER') return null
  const email = normalizeEmail(user.email)
  const membership = await client.teamMembership.upsert({
    where: { email },
    create: { email, role: user.role, status: 'ACTIVE', userId: user.id, claimedAt: new Date() },
    update: {},
    select: { id: true },
  })
  return membership.id
}

export type AccountStatus = 'invited' | 'unverified' | 'active' | 'suspended' | 'revoked'
export type ProfileStatus = 'not-started' | 'incomplete' | 'hidden' | 'published'

export interface MemberRow {
  id: string
  email: string
  name: string | null
  role: Role
  hasAccount: boolean
  emailVerified: boolean
  accountStatus: AccountStatus
  profileStatus: ProfileStatus
  position: string | null
  tier: string | null
  order: number | null
  visible: boolean | null
  missingFromMember: string[]
  missingFromAdmin: string[]
  invitedByName: string | null
  createdAt: string
}

interface DescribeInput {
  id: string
  email: string
  role: Role
  status: MembershipStatus
  createdAt: Date
  invitedByName: string | null
  publicPosition: string | null
  publicTier: string | null
  displayName: string | null
  /** For a PENDING row with no claimed account: the matching account's email state, if one exists. */
  unclaimedAccount?: { emailVerified: boolean } | null
  user: {
    name: string | null
    role: Role
    emailVerified: Date | null
    isActive: boolean
    isBanned: boolean
    teamProfile: { name: string; bio: string | null; image: string | null; role: string; publicTier: string | null; order: number; isActive: boolean } | null
  } | null
}

/** Pure: turns a membership (and its account/card, if any) into one admin-list row. */
export function describeMember(input: DescribeInput): MemberRow {
  const { user } = input
  const card = user?.teamProfile ?? null
  const tier = card ? card.publicTier : input.publicTier

  let accountStatus: AccountStatus
  if (input.status === 'REVOKED') accountStatus = 'revoked'
  else if (input.status === 'ACTIVE') accountStatus = user && (!user.isActive || user.isBanned) ? 'suspended' : 'active'
  else accountStatus = (user ? !user.emailVerified : input.unclaimedAccount && !input.unclaimedAccount.emailVerified) ? 'unverified' : 'invited'

  const position = (card ? card.role : input.publicPosition)?.trim() || null
  const assessment = assessProfileFacts({
    name: card?.name ?? user?.name ?? input.displayName,
    bio: card?.bio,
    image: card?.image,
    position,
    visible: card?.isActive ?? false,
  })

  let profileStatus: ProfileStatus
  if (!card) profileStatus = 'not-started'
  else if (assessment.publiclyVisible) profileStatus = 'published'
  else if (assessment.complete) profileStatus = 'hidden'
  else profileStatus = 'incomplete'

  return {
    id: input.id,
    email: input.email,
    name: card?.name?.trim() || user?.name?.trim() || input.displayName,
    role: input.status === 'ACTIVE' && user ? user.role : input.role,
    hasAccount: !!user || !!input.unclaimedAccount,
    emailVerified: !!user?.emailVerified || !!input.unclaimedAccount?.emailVerified,
    accountStatus,
    profileStatus,
    position,
    tier,
    order: card?.order ?? null,
    visible: card ? card.isActive : null,
    missingFromMember: assessment.missingFromMember,
    missingFromAdmin: assessment.missingFromAdmin,
    invitedByName: input.invitedByName,
    createdAt: input.createdAt.toISOString(),
  }
}


/** Every member the admin should see: memberships plus staff accounts that pre-date them. */
export async function listMembers(client: typeof prisma = prisma): Promise<MemberRow[]> {
  const userSelect = {
    id: true,
    name: true,
    role: true,
    emailVerified: true,
    isActive: true,
    isBanned: true,
    email: true,
    createdAt: true,
    teamProfile: { select: { name: true, bio: true, image: true, role: true, publicTier: true, order: true, isActive: true } },
  } as const

  const [memberships, bareStaff] = await Promise.all([
    client.teamMembership.findMany({ include: { user: { select: userSelect } }, orderBy: { createdAt: 'desc' } }),
    client.user.findMany({ where: { role: { not: 'READER' }, membership: null }, select: userSelect }),
  ])

  // A PENDING invitation has no claimed account, but one may already exist with that email
  // (registered, address not yet confirmed). The admin should see that.
  const pendingEmails = memberships.filter((m) => m.status === 'PENDING' && !m.user).map((m) => m.email)
  const waiting = pendingEmails.length
    ? await client.user.findMany({
        where: { OR: pendingEmails.map((address) => ({ email: { equals: address, mode: 'insensitive' as const } })) },
        select: { email: true, emailVerified: true },
      })
    : []
  const waitingByEmail = new Map(waiting.map((u) => [normalizeEmail(u.email), { emailVerified: !!u.emailVerified }]))

  const rows = memberships.map((m) =>
    describeMember({ ...m, user: m.user, unclaimedAccount: m.user ? null : (waitingByEmail.get(m.email) ?? null) }),
  )
  for (const user of bareStaff) {
    rows.push(
      describeMember({
        id: `${ACCOUNT_REF_PREFIX}${user.id}`,
        email: normalizeEmail(user.email),
        role: user.role,
        status: 'ACTIVE',
        createdAt: user.createdAt,
        invitedByName: null,
        publicPosition: null,
        publicTier: null,
        displayName: null,
        user,
      }),
    )
  }
  return rows
}
