/**
 * Administrative operations on Meet the Team cards, and the one place that decides whether a
 * card may be linked to an account.
 *
 * Three concepts stay separate (see also membership.ts):
 *   - AUTHORISATION   `User.role`: what the account may do. Nothing here reads or writes it.
 *   - OWNERSHIP       `TeamMember.userId` (UNIQUE): which account edits the card.
 *   - PUBLIC TITLE    `TeamMember.role` / `.publicTier`: what the card says and where it sits.
 *
 * Integrity rules, enforced here AND (for uniqueness) by the database:
 *   - A card has at most one owner and an account owns at most one card (UNIQUE userId).
 *   - Linking never overwrites: a card that already has a different owner, or an account that
 *     already has a card, is refused with an explanation. Re-pointing is unlink-then-link,
 *     two deliberate steps, so a single click can never silently take someone's profile.
 *   - Linking and unlinking touch ONLY `userId`. Name, bio, photo, title, placement, order and
 *     visibility are never rewritten, so no profile information is lost.
 *   - Matching is never guessed from names: `suggestCardsForAccount` only proposes, an
 *     administrator chooses. The stable account id is what gets stored.
 *   - Every write is guarded on the `updatedAt` the administrator loaded, so a stale form is
 *     refused rather than overwriting a newer change, and commits with its audit row.
 *
 * Authorisation of the caller is the route's job (ADMIN only).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueViolation } from '@/lib/prismaErrors'
import { MAX_BIO_LENGTH } from '@/lib/constants'
import { TEAM_TIER_ORDER } from '@/lib/teamHierarchy'
import { TEAM_PROFILE_ROLES, normalizePersonName, validateTeamBio } from '@/lib/teamProfiles'

type Tx = Prisma.TransactionClient

export const MAX_CARD_NAME_LENGTH = 100
export const MAX_CARD_POSITION_LENGTH = 100
export const NEW_CARD_ORDER = 1000

export type TeamCardErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_FIELD'
  | 'STALE'
  | 'ALREADY_LINKED'
  | 'ACCOUNT_HAS_CARD'
  | 'NOT_LINKED'
  | 'INELIGIBLE_ACCOUNT'
  | 'DUPLICATE_NAME'
  | 'CONFLICT'

export class TeamCardError extends Error {
  constructor(readonly code: TeamCardErrorCode, message: string, readonly status: number) {
    super(message)
  }
}

export interface CardActor {
  id: string
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface CardFieldsInput {
  name?: unknown
  position?: unknown
  publicTier?: unknown
  bio?: unknown
  image?: unknown
  email?: unknown
  order?: unknown
  visible?: unknown
}

export interface CardFields {
  name?: string
  role?: string
  publicTier?: string | null
  bio?: string | null
  image?: string | null
  email?: string | null
  order?: number
  isActive?: boolean
}

const invalid = (message: string) => new TeamCardError('INVALID_FIELD', message, 400)

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw invalid(`${label} must be text.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw invalid(`${label} must be ${max} characters or fewer.`)
  return trimmed
}

/** Only an https URL or a site-relative path may be stored as a photo; never script or data URLs. */
export function cleanImageRef(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw invalid('Photo must be an image URL.')
  const trimmed = value.trim()
  if (trimmed.length > 2048) throw invalid('Photo URL is too long.')
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'https:' || url.protocol === 'http:') return trimmed
  } catch {
    // fall through
  }
  throw invalid('Photo must be an http(s) image URL or a path starting with /.')
}

/** Parses the admin-editable public fields. `undefined` means "leave as it is". */
export function parseCardFields(input: CardFieldsInput): CardFields {
  const out: CardFields = {}
  if (input.name !== undefined) {
    const name = text(input.name, 'Name', MAX_CARD_NAME_LENGTH)
    if (!name) throw invalid('Name is required.')
    out.name = name
  }
  if (input.position !== undefined) {
    out.role = input.position === null ? '' : text(input.position, 'Position', MAX_CARD_POSITION_LENGTH)
  }
  if (input.publicTier !== undefined) {
    if (input.publicTier === null || input.publicTier === '') out.publicTier = null
    else if (typeof input.publicTier === 'string' && (TEAM_TIER_ORDER as readonly string[]).includes(input.publicTier)) {
      out.publicTier = input.publicTier
    } else throw invalid('Choose a valid public placement.')
  }
  if (input.bio !== undefined) {
    const bio = validateTeamBio(input.bio, MAX_BIO_LENGTH)
    if (!bio.ok) throw invalid(bio.error)
    out.bio = bio.bio
  }
  if (input.image !== undefined) out.image = cleanImageRef(input.image)
  if (input.email !== undefined) {
    if (input.email === null || input.email === '') out.email = null
    else {
      const email = text(input.email, 'Email', 254)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Enter a valid email address.')
      out.email = email
    }
  }
  if (input.order !== undefined) {
    if (typeof input.order !== 'number' || !Number.isInteger(input.order) || input.order < 0 || input.order > 9999) {
      throw invalid('Order must be a whole number from 0 to 9999.')
    }
    out.order = input.order
  }
  if (input.visible !== undefined) {
    if (typeof input.visible !== 'boolean') throw invalid('visible must be true or false.')
    out.isActive = input.visible
  }
  return out
}

// ── Audit ────────────────────────────────────────────────────────────────────

async function audit(
  tx: Tx,
  action: string,
  cardId: string,
  actor: CardActor,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({ data: { action, targetId: cardId, targetType: 'team_member', performedBy: actor.id, metadata } })
}

const staleMessage = 'This profile changed since you opened it. Reload and review it before saving.'

function assertFresh(expectedUpdatedAt: string | undefined, current: Date) {
  if (expectedUpdatedAt && expectedUpdatedAt !== current.toISOString()) {
    throw new TeamCardError('STALE', staleMessage, 409)
  }
}

/** An account a card may belong to: exists, active, not suspended, and holds a staff role. */
async function requireLinkableAccount(tx: Tx, userId: string) {
  const account = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, isBanned: true },
  })
  if (!account) throw new TeamCardError('INELIGIBLE_ACCOUNT', 'That account does not exist.', 400)
  if (!account.isActive || account.isBanned) {
    throw new TeamCardError('INELIGIBLE_ACCOUNT', 'That account is inactive or suspended.', 400)
  }
  if (!(TEAM_PROFILE_ROLES as readonly string[]).includes(account.role)) {
    throw new TeamCardError(
      'INELIGIBLE_ACCOUNT',
      'That account has no team access yet. Add it as a member (Admin, Editor, Writer or Growth) first.',
      400,
    )
  }
  return account
}

// ── Link / unlink ────────────────────────────────────────────────────────────

type CardForLink = { id: string; name: string; userId: string | null; updatedAt: Date }

const conflict = () =>
  new TeamCardError('CONFLICT', 'This profile was changed at the same time. Reload and try again.', 409)

/** Link steps, inside the caller's transaction. Returns whether anything changed. */
async function linkInTx(tx: Tx, actor: CardActor, card: CardForLink, userId: string): Promise<boolean> {
  // Idempotent: asking for the link that already exists is success, not a second audit row.
  if (card.userId === userId) return false
  if (card.userId) {
    const owner = await tx.user.findUnique({ where: { id: card.userId }, select: { email: true } })
    throw new TeamCardError(
      'ALREADY_LINKED',
      `"${card.name}" already belongs to ${owner?.email ?? 'another account'}. Unlink it first if that is a mistake.`,
      409,
    )
  }
  const account = await requireLinkableAccount(tx, userId)
  const owned = await tx.teamMember.findUnique({ where: { userId }, select: { id: true, name: true } })
  if (owned) {
    throw new TeamCardError(
      'ACCOUNT_HAS_CARD',
      `${account.email} already has a profile ("${owned.name}"). Unlink or delete it before linking a different one.`,
      409,
    )
  }
  // Only `userId` changes. The guard matches the row exactly as read.
  const linked = await tx.teamMember.updateMany({
    where: { id: card.id, userId: null, updatedAt: card.updatedAt },
    data: { userId },
  })
  if (linked.count !== 1) throw conflict()
  await audit(tx, 'TEAM_CARD_LINKED', card.id, actor, { userId, accountEmail: account.email, cardName: card.name })
  return true
}

async function unlinkInTx(tx: Tx, actor: CardActor, card: CardForLink): Promise<boolean> {
  if (!card.userId) return false
  const unlinked = await tx.teamMember.updateMany({
    where: { id: card.id, userId: card.userId, updatedAt: card.updatedAt },
    data: { userId: null },
  })
  if (unlinked.count !== 1) throw conflict()
  await audit(tx, 'TEAM_CARD_UNLINKED', card.id, actor, { previousUserId: card.userId, cardName: card.name })
  return true
}

/** Two administrators linking different cards to one account: the UNIQUE index decides. */
function mapUniqueViolation(error: unknown): never {
  if (isUniqueViolation(error)) throw new TeamCardError('ACCOUNT_HAS_CARD', 'That account already has a profile.', 409)
  throw error
}

export async function linkCardToAccount(
  actor: CardActor,
  cardId: string,
  userId: string,
  options: { expectedUpdatedAt?: string } = {},
  client: typeof prisma = prisma,
): Promise<{ id: string; userId: string; changed: boolean }> {
  try {
    return await client.$transaction(async (tx) => {
      const card = await tx.teamMember.findUnique({
        where: { id: cardId },
        select: { id: true, name: true, userId: true, updatedAt: true },
      })
      if (!card) throw new TeamCardError('NOT_FOUND', 'That profile no longer exists.', 404)
      assertFresh(options.expectedUpdatedAt, card.updatedAt)
      const changed = await linkInTx(tx, actor, card, userId)
      return { id: card.id, userId, changed }
    })
  } catch (error) {
    return mapUniqueViolation(error)
  }
}

export async function unlinkCard(
  actor: CardActor,
  cardId: string,
  options: { expectedUpdatedAt?: string } = {},
  client: typeof prisma = prisma,
): Promise<{ id: string; changed: boolean }> {
  return client.$transaction(async (tx) => {
    const card = await tx.teamMember.findUnique({
      where: { id: cardId },
      select: { id: true, name: true, userId: true, updatedAt: true },
    })
    if (!card) throw new TeamCardError('NOT_FOUND', 'That profile no longer exists.', 404)
    assertFresh(options.expectedUpdatedAt, card.updatedAt)
    return { id: card.id, changed: await unlinkInTx(tx, actor, card) }
  })
}

// ── Create / update / delete ─────────────────────────────────────────────────

export interface CreateCardInput extends CardFieldsInput {
  userId?: unknown
  /** The administrator has seen the "a profile with this name exists" warning and wants a second one. */
  allowDuplicateName?: unknown
}

export async function createCard(actor: CardActor, input: CreateCardInput, client: typeof prisma = prisma) {
  const fields = parseCardFields(input)
  if (!fields.name) throw invalid('Name is required.')
  let userId: string | null = null
  if (input.userId !== undefined && input.userId !== null && input.userId !== '') {
    if (typeof input.userId !== 'string') throw invalid('userId must be text.')
    userId = input.userId
  }

  try {
    return await client.$transaction(async (tx) => {
      if (userId) {
        const account = await requireLinkableAccount(tx, userId)
        const owned = await tx.teamMember.findUnique({ where: { userId }, select: { name: true } })
        if (owned) {
          throw new TeamCardError('ACCOUNT_HAS_CARD', `${account.email} already has a profile ("${owned.name}").`, 409)
        }
      }
      if (input.allowDuplicateName !== true) {
        const wanted = normalizePersonName(fields.name!)
        const names = await tx.teamMember.findMany({ select: { name: true } })
        if (names.some((c) => normalizePersonName(c.name) === wanted)) {
          throw new TeamCardError(
            'DUPLICATE_NAME',
            `A profile named "${fields.name}" already exists. Link or edit that one instead, or confirm that this is a different person.`,
            409,
          )
        }
      }
      const card = await tx.teamMember.create({
        data: {
          name: fields.name!,
          role: fields.role ?? '',
          publicTier: fields.publicTier ?? null,
          bio: fields.bio ?? null,
          image: fields.image ?? null,
          email: fields.email ?? null,
          order: fields.order ?? NEW_CARD_ORDER,
          // A new card is hidden until the administrator chooses to show it, unless they said so.
          isActive: fields.isActive ?? false,
          ...(userId ? { userId } : {}),
        },
      })
      await audit(tx, 'TEAM_CARD_CREATED', card.id, actor, {
        cardName: card.name,
        ...(userId ? { userId } : {}),
        visible: card.isActive,
      })
      return card
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TeamCardError('ACCOUNT_HAS_CARD', 'That account already has a profile.', 409)
    }
    throw error
  }
}

export interface UpdateCardOptions {
  expectedUpdatedAt?: string
  /** undefined: leave the owner alone. null: unlink. string: link to that account. */
  userId?: string | null
}

/**
 * Edits the public fields and, if asked, the owner, in ONE transaction: either the whole edit
 * (fields, link and audit rows) is applied or none of it is.
 */
export async function updateCard(
  actor: CardActor,
  cardId: string,
  input: CardFieldsInput,
  options: UpdateCardOptions = {},
  client: typeof prisma = prisma,
) {
  const fields = parseCardFields(input)
  try {
    return await client.$transaction(async (tx) => {
      const card = await tx.teamMember.findUnique({ where: { id: cardId } })
      if (!card) throw new TeamCardError('NOT_FOUND', 'That profile no longer exists.', 404)
      assertFresh(options.expectedUpdatedAt, card.updatedAt)

      let current: CardForLink = card
      if (options.userId !== undefined) {
        const changed = options.userId === null ? await unlinkInTx(tx, actor, card) : await linkInTx(tx, actor, card, options.userId)
        if (changed) {
          // The ownership write moved updatedAt; take the fresh token for the field write below.
          const refreshed = await tx.teamMember.findUniqueOrThrow({ where: { id: card.id }, select: { id: true, name: true, userId: true, updatedAt: true } })
          current = refreshed
        }
      }

      const changed = Object.keys(fields) as (keyof CardFields)[]
      if (changed.length === 0) return tx.teamMember.findUniqueOrThrow({ where: { id: card.id } })
      const written = await tx.teamMember.updateMany({ where: { id: card.id, updatedAt: current.updatedAt }, data: fields })
      if (written.count !== 1) throw conflict()
      await audit(tx, 'TEAM_CARD_UPDATED', card.id, actor, {
        cardName: card.name,
        ...(current.userId ? { userId: current.userId } : {}),
        fields: changed,
      })
      return tx.teamMember.findUniqueOrThrow({ where: { id: card.id } })
    })
  } catch (error) {
    return mapUniqueViolation(error)
  }
}

export async function deleteCard(
  actor: CardActor,
  cardId: string,
  options: { expectedUpdatedAt?: string } = {},
  client: typeof prisma = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const card = await tx.teamMember.findUnique({ where: { id: cardId } })
    if (!card) throw new TeamCardError('NOT_FOUND', 'That profile was already deleted.', 404)
    assertFresh(options.expectedUpdatedAt, card.updatedAt)
    const removed = await tx.teamMember.deleteMany({ where: { id: card.id, updatedAt: card.updatedAt } })
    if (removed.count !== 1) throw conflict()
    // The snapshot keeps the trail useful after the row is gone.
    await audit(tx, 'TEAM_CARD_DELETED', card.id, actor, {
      cardName: card.name,
      position: card.role,
      ...(card.userId ? { userId: card.userId } : {}),
      wasVisible: card.isActive,
    })
  })
}

/** Sets the display order of the given cards to the order of the list (10, 20, 30, ...). */
export async function reorderCards(
  actor: CardActor,
  orderedIds: string[],
  client: typeof prisma = prisma,
): Promise<void> {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.length > 200 || orderedIds.some((id) => typeof id !== 'string')) {
    throw invalid('Send the profile ids in the order you want.')
  }
  if (new Set(orderedIds).size !== orderedIds.length) throw invalid('A profile appears twice in the new order.')
  await client.$transaction(async (tx) => {
    const found = await tx.teamMember.count({ where: { id: { in: orderedIds } } })
    if (found !== orderedIds.length) {
      throw new TeamCardError('NOT_FOUND', 'A profile in this list no longer exists. Reload and try again.', 404)
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx.teamMember.update({ where: { id }, data: { order: (index + 1) * 10 } })
    }
    await audit(tx, 'TEAM_CARDS_REORDERED', orderedIds[0], actor, { count: orderedIds.length, ids: orderedIds })
  })
}

// ── Suggestions (never automatic) ────────────────────────────────────────────

export interface CardSuggestion {
  cardId: string
  name: string
  position: string
  email: string | null
  /** Why this card might be theirs. A name match is a hint only, never proof. */
  reasons: ('email' | 'name')[]
}

/** Unlinked cards that might belong to the account, best evidence first. The admin decides. */
export function suggestCards(
  account: { email: string; name: string | null },
  unlinked: { id: string; name: string; role: string; email: string | null }[],
): CardSuggestion[] {
  const email = account.email.trim().toLowerCase()
  const name = account.name ? normalizePersonName(account.name) : ''
  const out: CardSuggestion[] = []
  for (const card of unlinked) {
    const reasons: CardSuggestion['reasons'] = []
    if (card.email && card.email.trim().toLowerCase() === email) reasons.push('email')
    if (name && normalizePersonName(card.name) === name) reasons.push('name')
    if (reasons.length) out.push({ cardId: card.id, name: card.name, position: card.role, email: card.email, reasons })
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || Number(b.reasons.includes('email')) - Number(a.reasons.includes('email')))
}
