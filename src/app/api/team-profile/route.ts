import { withTestingAudit } from '@/lib/testingAudit'
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isUniqueViolation } from '@/lib/prismaErrors'
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
import {
  StorageUnavailableError,
  removeTeamPhoto,
  removeTeamPhotoAtPath,
  uploadTeamPhoto,
} from '@/lib/teamPhotoStorage'

// PUT /api/team-profile — create or update the caller's OWN Meet the Team card.
//
// The client may send exactly four things: `name` (the display name), `bio`, an optional
// `image` file and `removeImage`. Everything that identifies or places the card comes from
// the verified session or from an administrator, never the request:
//   - the owner       → session user id (written to the unique `userId` column)
//   - appointment     → admin-managed title / publicTier / order / visibility, preserved on update
// A request that names any of those (or a role/userId) is REJECTED with 400, not silently
// ignored, so a forged value is visible rather than a no-op.
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
 * Raised when an unlinked legacy card looks like this person's. Creating a second
 * card would put them on the page twice, so an admin has to link the existing one.
 */
class LegacyCardNeedsLink extends Error {}
class NoPublicAppointment extends Error {}

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
    if (!mimeType) {
      return apiError('Photo must be a JPEG, PNG, GIF, WebP or AVIF image.', 400, 'PHOTO_TYPE')
    }
    photo = { bytes, mimeType }
  } else if (file !== null && !(file instanceof File)) {
    return apiError('image must be a file.', 400, 'INVALID_BODY')
  }

  try {
    const existing = await prisma.teamMember.findUnique({
      where: { userId: user.id },
      select: { id: true, image: true },
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

    const nextImage = uploaded ? uploaded.url : removeImage ? null : undefined
    const update = {
      // A submitted name replaces the card's; an absent one leaves it alone.
      ...(submittedName ? { name: submittedName } : {}),
      // An absent field leaves the bio alone; an empty one clears it.
      ...(bioField !== null ? { bio: bio.bio } : {}),
      ...(nextImage !== undefined ? { image: nextImage } : {}),
    }

    let profile
    try {
      profile = await saveProfile(user.id, user.email, name, update, bio.bio, nextImage ?? null, user.role)
    } catch (error) {
      // The database is the source of truth: if the write failed, the new file is
      // unreferenced, so remove it rather than leave it behind.
      if (uploaded) await removeTeamPhotoAtPath(uploaded.path)
      throw error
    }

    // Only after the row points at the new photo is the old one safe to delete.
    if (nextImage !== undefined && existing?.image && existing.image !== nextImage) {
      await removeTeamPhoto(existing.image, user.id)
    }

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
      },
      { status: existing ? 200 : 201 },
    )
  } catch (error) {
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

type ProfileUpdate = { name?: string; bio?: string | null; image?: string | null }

/**
 * Persists the card for `userId` and returns it.
 *
 * 1. If exactly one unclaimed legacy card carries this account's email, adopt it
 *    rather than create a second card for the same person.
 * 2. If an unclaimed card looks like theirs but cannot be claimed safely
 *    (ambiguous email, or the same name), refuse — an admin must link it.
 * 3. Otherwise upsert on the unique `userId`.
 * A unique violation means a concurrent request created the card first; the retry
 * then takes the update path, so the end state is always one row.
 */
async function saveProfile(
  userId: string,
  email: string | null,
  name: string,
  update: ProfileUpdate,
  createBio: string | null,
  createImage: string | null,
  permissionRole: string,
) {
  const attempt = async () => {
    const linked = await prisma.teamMember.findUnique({ where: { userId } })
    if (permissionRole === 'ADMIN') {
      if (!linked) throw new NoPublicAppointment()
      return prisma.teamMember.update({ where: { userId }, data: update })
    }
    if (!linked) {
      const match = await matchLegacyCard(prisma, { name, email })
      if (match.kind === 'blocked') throw new LegacyCardNeedsLink()
      if (match.kind === 'adoptable') {
        // `userId: null` in the filter makes the claim atomic: only one request
        // can win the row.
        const claimed = await prisma.teamMember.updateMany({
          where: { id: match.card.id, userId: null },
          data: { userId, ...update },
        })
        if (claimed.count === 1) {
          return prisma.teamMember.findUniqueOrThrow({ where: { id: match.card.id } })
        }
      }
    }
    return prisma.teamMember.upsert({
      where: { userId },
      create: {
        userId,
        name,
        ...(defaultPublicAppointment(permissionRole) ?? { role: '' }),
        bio: createBio,
        image: createImage,
        order: NEW_CARD_ORDER,
        // Hidden until an administrator confirms the title and shows it.
        isActive: false,
      },
      update,
    })
  }

  try {
    return await attempt()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return await attempt()
  }
}

export const PUT = withTestingAudit(PUTHandler)
