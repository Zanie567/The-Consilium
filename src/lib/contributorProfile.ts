/**
 * The ONE server-side writer of a person's shared contributor details: name, biography and photo
 * (server-side only).
 *
 * Every screen that edits them calls `applySharedProfileChanges` inside a transaction:
 *   - the account page            PATCH /api/profile/account
 *   - the editorial Team Profile  PUT   /api/team-profile
 *   - the admin user editor       PATCH /api/editorial/users/[id]
 *   - the admin Team Members editor goes through teamCards.updateCard, which uses
 *     `writeAccountFromCard` from here for the same reason.
 * so the account (`User`) and the linked Meet the Team card (`TeamMember`) cannot drift apart again.
 *
 * Rules:
 *   - Only the fields a request names are written, and they are written to BOTH records (when the
 *     card is kept in step, see `cardFollowsAccount`). A field nobody touched is never rewritten,
 *     so a detailed biography that only exists on one record survives an unrelated save.
 *   - Each named field may carry the value the editor showed (`expected`). If the stored value has
 *     changed since, the whole save is refused (409 STALE) instead of overwriting newer work.
 *   - Both rows are locked (account first, then card) for the length of the transaction, so two
 *     saves cannot interleave between the check and the write.
 *   - Whatever a save replaces on either record is copied into its audit row, so earlier text or
 *     a photo reference (including details entered separately before the records were joined) can
 *     always be recovered.
 *   - Nothing here reads or writes role, email, display titles, the card's title, placement, order,
 *     visibility or owner. Callers authenticate and decide whose record this is.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isInOwnAvatarFolder, validateAvatarUrl } from '@/lib/avatarUrl'
import { checkImageRef } from '@/lib/imageRef'
import { removeTeamPhoto } from '@/lib/teamPhotoStorage'
import {
  SHARED_FIELDS,
  cardFollowsAccount,
  normalizeShared,
  pickShared,
  sameShared,
  type SharedField,
  type SharedValues,
} from '@/lib/profileFields'

type Tx = Prisma.TransactionClient

export type ProfileSaveErrorCode = 'NOT_FOUND' | 'STALE' | 'NAME_REQUIRED' | 'BIO_REQUIRED' | 'INVALID_IMAGE'

export class ProfileSaveError extends Error {
  constructor(
    readonly code: ProfileSaveErrorCode,
    message: string,
    readonly status: number,
    readonly fields: SharedField[] = [],
  ) {
    super(message)
  }
}

export interface FieldChange {
  value: string | null
  /** What the editor showed for this field. Omitted: no staleness check for this field. */
  expected?: string | null
}
export type SharedChanges = Partial<Record<SharedField, FieldChange>>

export interface SharedSaveInput {
  userId: string
  changes: SharedChanges
  actor: { id: string; administrator: boolean }
  /** Recorded in the audit row. */
  via: 'account' | 'team-profile' | 'admin-user'
  /**
   * Which record the editor displayed, i.e. what `expected` refers to. 'shared' (default) is the
   * card when it is kept in step and the account otherwise: what sharedProfileView shows.
   */
  compareWith?: 'shared' | 'account'
  /**
   * 'own-upload': a new photo must be the person's own upload in the avatars bucket, or one already
   * stored on one of their two records. 'admin': any safe image reference (imageRef.ts).
   */
  imageRule: 'own-upload' | 'admin'
  /** Refuse to clear the biography of a card that is switched on (it would vanish from Our Team). */
  keepPublishedBio?: boolean
}

export interface SharedSaveResult {
  account: SharedValues
  card: (SharedValues & { id: string; isActive: boolean }) | null
  /** Whether the card was kept in step with the account. */
  linked: boolean
  /** Fields actually written (to at least one record). */
  changed: SharedField[]
  /** Photos this save stopped using. Pass to `releaseUnusedPhotos` AFTER the transaction commits. */
  previousPhotos: string[]
}

/** Locks the account row and its card row, always in that order (account, then card). */
export async function lockProfileRows(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM team_members WHERE "userId" = ${userId} FOR UPDATE`
}

const staleMessage = (fields: SharedField[]) =>
  `Your ${fields.map((f) => (f === 'bio' ? 'biography' : f === 'image' ? 'photo' : 'name')).join(' and ')} changed since this page was opened` +
  ' (perhaps in another tab or by an administrator). Reload to see the latest version before saving.'

function checkImage(
  value: string | null,
  rule: SharedSaveInput['imageRule'],
  userId: string,
  current: (string | null)[],
): string | null {
  if (value === null) return null
  if (rule === 'admin') {
    const result = checkImageRef(value)
    if (!result.ok) throw new ProfileSaveError('INVALID_IMAGE', result.error, 400, ['image'])
    return result.value
  }
  // Already stored on this person's own account or card (for example a sign-in photo, or the
  // team photo chosen as the account photo): not re-validated, nothing new is introduced.
  if (current.some((stored) => stored !== null && stored === value)) return value
  const result = validateAvatarUrl(value)
  if (!result.ok) throw new ProfileSaveError('INVALID_IMAGE', result.error, 400, ['image'])
  if (result.url !== null && !isInOwnAvatarFolder(result.url, userId)) {
    throw new ProfileSaveError('INVALID_IMAGE', 'You can only use a photo that you uploaded yourself.', 400, ['image'])
  }
  return result.url
}

/**
 * Applies the named changes to the account and, when kept in step, its linked card. Must run inside
 * the caller's transaction; it takes the row locks itself.
 */
export async function applySharedProfileChanges(tx: Tx, input: SharedSaveInput): Promise<SharedSaveResult> {
  await lockProfileRows(tx, input.userId)
  const account = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, bio: true, image: true, role: true },
  })
  if (!account) throw new ProfileSaveError('NOT_FOUND', 'That account no longer exists.', 404)
  const card = await tx.teamMember.findUnique({
    where: { userId: input.userId },
    select: { id: true, name: true, bio: true, image: true, isActive: true },
  })
  const linked = cardFollowsAccount({ role: account.role, hasCard: Boolean(card), byAdministrator: input.actor.administrator })
  const accountValues = pickShared(account)
  const cardValues = card ? pickShared(card) : null
  const shown = input.compareWith === 'account' || !linked || !cardValues ? accountValues : cardValues

  const requested = SHARED_FIELDS.filter((field) => input.changes[field] !== undefined)
  const stale = requested.filter((field) => {
    const change = input.changes[field]!
    return change.expected !== undefined && !sameShared(change.expected, shown[field])
  })
  if (stale.length > 0) throw new ProfileSaveError('STALE', staleMessage(stale), 409, stale)

  const next: Partial<SharedValues> = {}
  for (const field of requested) {
    const raw = normalizeShared(input.changes[field]!.value)
    next[field] = field === 'image'
      ? checkImage(raw, input.imageRule, input.userId, [accountValues.image, cardValues?.image ?? null])
      : raw
  }

  if (linked && 'name' in next && next.name === null) {
    throw new ProfileSaveError('NAME_REQUIRED', 'Your public profile needs a name. Enter the name readers should see.', 400, ['name'])
  }
  if (linked && input.keepPublishedBio && card?.isActive && 'bio' in next && next.bio === null) {
    throw new ProfileSaveError(
      'BIO_REQUIRED',
      'Your profile is published on the Our Team page, which needs a biography. Write a new one instead of clearing it, or ask an administrator to hide the profile first.',
      400,
      ['bio'],
    )
  }

  const accountData: Prisma.UserUpdateInput = {}
  const cardData: Prisma.TeamMemberUpdateInput = {}
  // What each record held before, for every field this save rewrites. Kept in the audit row so any
  // replaced text or photo, including details entered separately before the records were joined,
  // can be recovered.
  const previous: { account?: Partial<SharedValues>; card?: Partial<SharedValues> } = {}
  const changed = new Set<SharedField>()
  for (const field of SHARED_FIELDS) {
    if (!(field in next)) continue
    const value = next[field]!  // may be null
    if (!sameShared(accountValues[field], value)) {
      accountData[field] = value
      previous.account = { ...previous.account, [field]: accountValues[field] }
      changed.add(field)
    }
    if (linked && cardValues && !sameShared(cardValues[field], value)) {
      cardData[field] = value as string // a linked card's name cannot be cleared (checked above)
      previous.card = { ...previous.card, [field]: cardValues[field] }
      changed.add(field)
    }
  }

  if (Object.keys(accountData).length > 0) await tx.user.update({ where: { id: input.userId }, data: accountData })
  if (card && Object.keys(cardData).length > 0) await tx.teamMember.update({ where: { id: card.id }, data: cardData })

  // Every save that touches a card, or is made by an administrator, is recorded. A reader editing
  // their own account (no card involved) is not, exactly as before.
  if (changed.size > 0 && (linked || input.actor.administrator)) {
    await tx.auditLog.create({
      data: {
        action: 'CONTRIBUTOR_PROFILE_UPDATED',
        targetId: input.userId,
        targetType: 'user',
        performedBy: input.actor.id,
        metadata: {
          via: input.via,
          fields: [...changed],
          keptInStep: linked,
          ...(card ? { cardId: card.id } : {}),
          previous,
        },
      },
    })
  }

  // Every named field now holds `next` on the account, and on the card when it is kept in step.
  const finalAccount: SharedValues = { ...accountValues, ...next }
  const finalCard = card && cardValues
    ? { id: card.id, isActive: card.isActive, ...cardValues, ...(linked ? next : {}) }
    : null
  const previousPhotos = 'image' in next
    ? [accountValues.image, linked ? cardValues?.image ?? null : null].filter(
        (url): url is string => url !== null && url !== next.image,
      )
    : []
  return { account: finalAccount, card: finalCard, linked, changed: [...changed], previousPhotos: [...new Set(previousPhotos)] }
}

/**
 * The account side of an administrator's card edit (teamCards.updateCard): the shared fields the
 * administrator changed on a linked card are written to the account too, inside the same
 * transaction. The caller must already hold the locks (lockProfileRows) and pass the card's values
 * from before the edit. Returns the fields written and the account values they replaced (for the audit row).
 */
export async function writeAccountFromCard(
  tx: Tx,
  userId: string,
  before: SharedValues,
  after: Partial<SharedValues>,
): Promise<{ fields: SharedField[]; previous: Partial<SharedValues> }> {
  const account = await tx.user.findUnique({ where: { id: userId }, select: { name: true, bio: true, image: true } })
  if (!account) return { fields: [], previous: {} }
  const accountValues = pickShared(account)
  const data: Prisma.UserUpdateInput = {}
  const previous: Partial<SharedValues> = {}
  for (const field of SHARED_FIELDS) {
    if (!(field in after) || sameShared(before[field], after[field])) continue // not edited by the administrator
    const value = normalizeShared(after[field])
    if (sameShared(accountValues[field], value)) continue
    previous[field] = accountValues[field]
    data[field] = value
  }
  if (Object.keys(data).length > 0) await tx.user.update({ where: { id: userId }, data })
  return { fields: Object.keys(data) as SharedField[], previous }
}

/**
 * Deletes photos this person no longer uses, once nothing references them: neither any account nor
 * any card (any person's) still points at the URL. Only files in the owner's own `<userId>/` folder
 * of the avatars bucket can ever be removed (removeTeamPhoto refuses anything else), and a failure
 * to check or delete keeps the file. Never throws.
 */
export async function releaseUnusedPhotos(urls: string[], ownerId: string, client: typeof prisma = prisma): Promise<void> {
  for (const url of new Set(urls)) {
    const stillUsed = await Promise.all([
      client.user.findFirst({ where: { image: url }, select: { id: true } }),
      client.teamMember.findFirst({ where: { image: url }, select: { id: true } }),
    ]).then(([user, card]) => Boolean(user || card)).catch(() => true)
    if (!stillUsed) await removeTeamPhoto(url, ownerId)
  }
}

/**
 * Reads an `expected` object from a JSON body: the values the editor showed, `{ name?, bio?, image? }`,
 * each text or null. Absent is `{}`; anything malformed is null (the route answers 400).
 */
export function parseExpectedValues(raw: unknown): Partial<Record<SharedField, string | null>> | null {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const out: Partial<Record<SharedField, string | null>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(SHARED_FIELDS as readonly string[]).includes(key) || (value !== null && typeof value !== 'string')) return null
    out[key as SharedField] = value
  }
  return out
}

/** Turns a ProfileSaveError into the response body every profile route uses. */
export function profileSaveErrorBody(error: ProfileSaveError) {
  return { error: error.message, code: error.code, ...(error.fields.length ? { fields: error.fields } : {}) }
}
