import { withTestingAudit } from '@/lib/testingAudit'
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { apiError, apiServerErrorResponse } from '@/lib/apiResponse'
import { MAX_BIO_LENGTH, MAX_TEAM_PHOTO_BYTES } from '@/lib/constants'
import { detectImageMimeType } from '@/lib/imageSniff'
import {
  assessProfile,
  defaultPublicAppointment,
  publicAppointmentLabel,
  TEAM_PROFILE_ROLES,
  validateTeamBio,
} from '@/lib/teamProfiles'
import { matchLegacyCard } from '@/lib/teamProfileLegacy'
import { StorageUnavailableError, removeTeamPhotoAtPath, uploadTeamPhoto } from '@/lib/teamPhotoStorage'
import {
  ProfileSaveError,
  applySharedProfileChanges,
  lockProfileRows,
  profileSaveErrorBody,
  releaseUnusedPhotos,
  type SharedChanges,
} from '@/lib/contributorProfile'
import { sharedProfileView } from '@/lib/profileFields'

// PUT /api/team-profile — create or update the caller's OWN Meet the Team card.
//
// The client may send: `name` (the display name), `bio`, an optional `image` file, `removeImage`,
// `imageUrl` (a photo already stored on the caller's own account or card, to use here too) and
// `expectedName` / `expectedBio` / `expectedImage` (what the form showed; an empty value means
// "nothing"). Everything that identifies or places the card comes from the verified session or
// from an administrator, never the request:
//   - the owner       → session user id (written to the unique `userId` column)
//   - appointment     → admin-managed title / publicTier / order / visibility, preserved on update
// A request that names any of those (or a role/userId) is REJECTED with 400, not silently
// ignored, so a forged value is visible rather than a no-op.
//
// Name, description and photo are shared with the caller's account: the save goes through
// contributorProfile.ts, which writes the fields sent to the card AND the account in one
// transaction (so bylines and the account page show the same), and refuses a stale form.
//
// One card per account is guaranteed by the UNIQUE index on `userId`, not by the
// look-up below: that look-up only decides 201 vs 200 and finds a legacy card to
// adopt. Concurrent or repeated creates collapse onto the same row.

/** Where new cards sit among the admin-ordered legacy ones: after them, by name. */
const NEW_CARD_ORDER = 1000

/** Fields only an administrator may set. Naming one in this request is an error. */
const ADMIN_ONLY_FIELDS = [
  'role', 'team', 'publicTier', 'position', 'title', 'order', 'isActive', 'visible', 'userId', 'id', 'email', 'status', 'permissions',
]
const MAX_DISPLAY_NAME_LENGTH = 100

/**
 * The photo becomes the account photo too (bylines, comments), so it follows the account photo
 * rules: no GIF (animation on every byline) or AVIF, as POST /api/upload enforces for avatars.
 */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Raised when an unlinked legacy card looks like this person's. Creating a second
 * card would put them on the page twice, so an admin has to link the existing one.
 */
class LegacyCardNeedsLink extends Error {}
class NoPublicAppointment extends Error {}

/** A text field that may be absent (undefined) or empty (null). */
function optionalText(form: FormData, key: string): string | null | undefined | false {
  const value = form.get(key)
  if (value === null) return undefined
  if (typeof value !== 'string') return false
  return value.trim() === '' ? null : value
}

async function PUTHandler(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(TEAM_PROFILE_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return apiError('The request must be multipart form data.', 400, 'INVALID_BODY')
  }

  const forbidden = ADMIN_ONLY_FIELDS.filter((field) => form.has(field))
  if (forbidden.length > 0) {
    return apiError(
      `You cannot set ${forbidden.join(', ')}. Position, placement, order and visibility are managed by an administrator.`,
      400,
      'FORBIDDEN_FIELD',
    )
  }

  const bioField = form.get('bio')
  const bio = validateTeamBio(bioField === null ? undefined : bioField, MAX_BIO_LENGTH)
  if (!bio.ok) return apiError(bio.error, 400, 'INVALID_BIO')

  // The display name is the member's own to choose; it falls back to the account name.
  const nameField = form.get('name')
  if (nameField !== null && typeof nameField !== 'string') {
    return apiError('name must be text.', 400, 'INVALID_NAME')
  }
  // An empty field means "keep what I have", not "set an empty name".
  const submittedName = typeof nameField === 'string' ? nameField.trim() || null : null
  if (submittedName !== null && (submittedName.length < 2 || submittedName.length > MAX_DISPLAY_NAME_LENGTH)) {
    return apiError(`Your name must be between 2 and ${MAX_DISPLAY_NAME_LENGTH} characters.`, 400, 'INVALID_NAME')
  }
  const name = submittedName || user.name?.trim()
  if (!name) {
    return apiError('Enter the name you want shown on your team profile.', 400, 'NAME_REQUIRED')
  }

  const expected = {
    name: optionalText(form, 'expectedName'),
    bio: optionalText(form, 'expectedBio'),
    image: optionalText(form, 'expectedImage'),
  }
  const imageUrl = optionalText(form, 'imageUrl')
  if (Object.values(expected).includes(false) || imageUrl === false) {
    return apiError('expected values and imageUrl must be text.', 400, 'INVALID_BODY')
  }

  const file = form.get('image')
  const removeImage = form.get('removeImage') === 'true'
  let photo: { bytes: ArrayBuffer; mimeType: string } | null = null
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_TEAM_PHOTO_BYTES) {
      return apiError(
        `Photo is too large (max ${MAX_TEAM_PHOTO_BYTES / (1024 * 1024)} MB).`,
        400,
        'PHOTO_TOO_LARGE',
      )
    }
    const bytes = await file.arrayBuffer()
    const mimeType = detectImageMimeType(new Uint8Array(bytes))
    if (!mimeType || !PHOTO_TYPES.has(mimeType)) {
      return apiError('Photo must be a JPEG, PNG or WebP image.', 400, 'PHOTO_TYPE')
    }
    photo = { bytes, mimeType }
  } else if (file !== null && !(file instanceof File)) {
    return apiError('image must be a file.', 400, 'INVALID_BODY')
  }

  try {
    const existing = await prisma.teamMember.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })

    if (user.role === 'ADMIN' && !existing) {
      return apiError('Ask an administrator to assign and link your public appointment first.', 403, 'NO_PUBLIC_APPOINTMENT')
    }

    // Upload first: a failed upload must leave the card untouched.
    let uploaded: { url: string; path: string } | null = null
    if (photo) {
      try {
        uploaded = await uploadTeamPhoto(user.id, photo.bytes, photo.mimeType)
      } catch (error) {
        if (error instanceof StorageUnavailableError) {
          return apiError('Photo storage is not available right now.', 503, 'STORAGE_UNAVAILABLE')
        }
        console.error('[team-profile] upload failed', error)
        return apiError('The photo could not be uploaded. Try again.', 502, 'PHOTO_UPLOAD_FAILED')
      }
    }

    // undefined = leave the photo alone, null = remove it, string = use it.
    const nextImage = uploaded ? uploaded.url : removeImage ? null : imageUrl === undefined ? undefined : imageUrl
    const changes: SharedChanges = {}
    const withExpected = (value: string | null, field: 'name' | 'bio' | 'image') => ({
      value,
      ...(expected[field] !== undefined ? { expected: expected[field] as string | null } : {}),
    })
    // A submitted name replaces the card's; an absent one leaves it alone.
    if (submittedName) changes.name = withExpected(submittedName, 'name')
    // An absent field leaves the bio alone; an empty one clears it.
    if (bioField !== null) changes.bio = withExpected(bio.bio, 'bio')
    if (nextImage !== undefined) changes.image = withExpected(nextImage, 'image')

    let saved
    try {
      saved = await prisma.$transaction((tx) => saveProfile(tx, user, name, changes))
    } catch (error) {
      // The database is the source of truth: if the write failed, the new file is
      // unreferenced, so remove it rather than leave it behind.
      if (uploaded) await removeTeamPhotoAtPath(uploaded.path)
      throw error
    }

    // Only after both rows point at the new photo is the old one safe to delete, and only
    // when no account or card anywhere still uses it.
    await releaseUnusedPhotos(saved.shared.previousPhotos, user.id)

    const profile = saved.card
    return NextResponse.json(
      {
        id: profile.id,
        name: profile.name,
        bio: profile.bio,
        image: profile.image,
        teamLabel: publicAppointmentLabel(profile),
        status: assessProfile({
          name: profile.name,
          bio: profile.bio,
          image: profile.image,
          position: profile.role,
          visible: profile.isActive,
        }),
        profile: sharedProfileView(saved.shared.account, saved.shared.card, saved.shared.linked),
      },
      { status: saved.created ? 201 : 200 },
    )
  } catch (error) {
    if (error instanceof ProfileSaveError) return NextResponse.json(profileSaveErrorBody(error), { status: error.status })
    if (error instanceof NoPublicAppointment) return apiError('Your public appointment is no longer assigned. Reload and ask an administrator.', 403, 'NO_PUBLIC_APPOINTMENT')
    if (error instanceof LegacyCardNeedsLink) {
      return apiError(
        'A team card for you already exists but is not linked to your account yet. ' +
          'Ask an administrator to link it, so you edit that card instead of appearing twice.',
        409,
        'LEGACY_CARD_NEEDS_LINK',
      )
    }
    return apiServerErrorResponse(error, {
      operation: 'team-profile:save',
      userMessage: 'Your team profile could not be saved because of a server error.',
      code: 'TEAM_PROFILE_SAVE_FAILED',
    })
  }
}

type Tx = Prisma.TransactionClient

/**
 * Makes sure the caller has their card, then saves the shared fields through contributorProfile.
 *
 * 1. An existing linked card is edited in place.
 * 2. If exactly one unclaimed legacy card carries this account's email, it is adopted rather
 *    than a second card created; the form showed that card, so `expected` refers to it.
 * 3. If an unclaimed card looks like theirs but cannot be claimed safely (ambiguous email, or
 *    the same name), refuse — an admin must link it.
 * 4. Otherwise a new HIDDEN card is created from the account's current details (so a biography
 *    or photo written on the account page is carried over, not lost); the form showed those
 *    account details, so `expected` refers to the account.
 * The account row is locked first, so concurrent creates for the same person queue up, and the
 * UNIQUE index on `userId` (skipDuplicates) still guarantees one row.
 */
async function saveProfile(
  tx: Tx,
  user: { id: string; email: string | null; role: string },
  name: string,
  changes: SharedChanges,
) {
  await lockProfileRows(tx, user.id)
  let created = false
  let compareWith: 'shared' | 'account' = 'shared'
  const linked = await tx.teamMember.findUnique({ where: { userId: user.id }, select: { id: true } })
  if (!linked) {
    if (user.role === 'ADMIN') throw new NoPublicAppointment()
    const match = await matchLegacyCard(tx, { name, email: user.email })
    if (match.kind === 'blocked') throw new LegacyCardNeedsLink()
    // `userId: null` in the filter makes the claim atomic: only one request can win the row. As
    // before, an adopted card takes the person's own name (the form shows it), replacing the old
    // spelling an administrator typed; everything else on it is kept until they change it.
    const claimed = match.kind === 'adoptable'
      ? (await tx.teamMember.updateMany({ where: { id: match.card.id, userId: null }, data: { userId: user.id, name } })).count === 1
      : false
    if (!claimed) {
      const account = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, bio: true, image: true } })
      const inserted = await tx.teamMember.createMany({
        data: [{
          userId: user.id,
          name: account.name?.trim() || name,
          ...(defaultPublicAppointment(user.role) ?? { role: '' }),
          bio: account.bio?.trim() || null,
          image: account.image?.trim() || null,
          order: NEW_CARD_ORDER,
          // Hidden until an administrator confirms the title and shows it.
          isActive: false,
        }],
        skipDuplicates: true,
      })
      // A brand-new card was copied from the account, which is what the form showed.
      if (inserted.count === 1) compareWith = 'account'
    }
    // Adopted or new, the caller had no card before this request: 201, as before.
    created = true
  }
  const shared = await applySharedProfileChanges(tx, {
    userId: user.id,
    changes,
    actor: { id: user.id, administrator: false },
    via: 'team-profile',
    compareWith,
    imageRule: 'own-upload',
    keepPublishedBio: true,
  })
  const card = await tx.teamMember.findUniqueOrThrow({ where: { userId: user.id } })
  return { created, card, shared }
}

export const PUT = withTestingAudit(PUTHandler)
