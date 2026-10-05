import { withTestingAudit } from '@/lib/testingAudit'
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'
import { MAX_BIO_LENGTH, MAX_NAME_LENGTH } from '@/lib/constants'
import { validateDisplayTitles } from '@/lib/displayTitles'
import { removeTeamPhoto } from '@/lib/teamPhotoStorage'
import { validateAvatarUrl } from '@/lib/avatarUrl'
import { apiServerErrorResponse } from '@/lib/apiResponse'

// PATCH /api/profile/account - update the caller's own display name, bio, profile
// image and (ADMIN only) display titles.
//
// The target is always the session user: no id is read from the body or the URL.
// The body is an explicit allowlist. Any other key (role, email, isActive, isBanned,
// slug, id, ...) is rejected with a 400 rather than silently ignored, so a
// hand-crafted request cannot be mistaken for a successful one. Role in particular
// is admin-only (PATCH /api/editorial/users/[id], which logs the change) and is
// never written here under any circumstances.
//
// displayTitles are labels, not permissions. Only an ADMIN may write them, checked
// here against the role on the verified session user; everyone else gets a 403.
const ALLOWED_KEYS = new Set(['name', 'bio', 'image', 'displayTitles'])

async function PATCHHandler(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'The request body is not valid JSON.' }, { status: 400 })
  }

  // `null` is valid JSON, and destructuring it throws, which would surface as a
  // 500 rather than the 400 this is.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'The request body must be a JSON object.' }, { status: 400 })
  }

  const unknownKeys = Object.keys(body).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknownKeys.length > 0) {
    return NextResponse.json({ error: 'Request includes fields you cannot update.' }, { status: 400 })
  }

  const { name, bio, image, displayTitles } = body
  if (name !== undefined && typeof name !== 'string') {
    return NextResponse.json({ error: 'name must be a string' }, { status: 400 })
  }
  if (typeof name === 'string' && name.trim().length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Your name must be ${MAX_NAME_LENGTH} characters or fewer.` },
      { status: 400 },
    )
  }
  if (bio !== undefined && typeof bio !== 'string') {
    return NextResponse.json({ error: 'bio must be a string' }, { status: 400 })
  }
  // The form caps the field, but a client can send anything. The bio renders on
  // public pages, so the limit is enforced here too.
  if (typeof bio === 'string' && bio.trim().length > MAX_BIO_LENGTH) {
    return NextResponse.json(
      { error: `Your bio must be ${MAX_BIO_LENGTH} characters or fewer.` },
      { status: 400 },
    )
  }
  if (image !== undefined && typeof image !== 'string') {
    return NextResponse.json({ error: 'image must be a string' }, { status: 400 })
  }
  // Only a file in our own avatars bucket is accepted. See validateAvatarUrl for
  // why an arbitrary URL from a user is not safe to store and render publicly.
  let nextImage: string | null | undefined
  if (typeof image === 'string') {
    const result = validateAvatarUrl(image)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    nextImage = result.url
  }

  let nextTitles: string[] | undefined
  if (displayTitles !== undefined) {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only an administrator can change display titles.' }, { status: 403 })
    }
    const result = validateDisplayTitles(displayTitles)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    nextTitles = result.titles
  }

  try {
    // Read the current photo first so it can be removed once the new one is saved.
    const before =
      nextImage !== undefined
        ? await prisma.user.findUnique({ where: { id: user.id }, select: { image: true } })
        : null

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(typeof name === 'string' ? { name: name.trim() || null } : {}),
        ...(typeof bio === 'string' ? { bio: bio.trim() || null } : {}),
        ...(nextImage !== undefined ? { image: nextImage } : {}),
        ...(nextTitles !== undefined ? { displayTitles: nextTitles } : {}),
      },
      select: { id: true, name: true, bio: true, image: true, displayTitles: true },
    })

    // Only after the row points at the new photo is the old one safe to delete.
    // removeTeamPhoto refuses anything outside `<userId>/` in the avatars bucket and
    // never throws, so a leftover file cannot fail a save that already succeeded.
    if (nextImage !== undefined && before?.image && before.image !== nextImage) {
      const stillUsed = await prisma.teamMember
        .findFirst({ where: { image: before.image }, select: { id: true } })
        .catch(() => ({ id: 'unknown' }))
      if (!stillUsed) await removeTeamPhoto(before.image, user.id)
    }

    return NextResponse.json(updated)
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'profile/account:update',
      userMessage: 'Your account could not be updated because of a server error.',
      code: 'ACCOUNT_UPDATE_FAILED',
    })
  }
}

// DELETE /api/profile/account - permanently delete the account
async function DELETEHandler(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  let confirmEmail: unknown
  try {
    ;({ confirmEmail } = await request.json())
  } catch {
    return NextResponse.json({ error: 'The request body is not valid JSON.' }, { status: 400 })
  }

  if (typeof confirmEmail !== 'string') {
    return NextResponse.json({ error: 'confirmEmail must be a string' }, { status: 400 })
  }

  try {
    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } })

    if (!confirmEmail || confirmEmail.toLowerCase() !== dbUser?.email.toLowerCase()) {
      return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
    }

    await prisma.user.delete({ where: { id: user.id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'profile/account:delete',
      userMessage: 'Your account could not be deleted because of a server error.',
      code: 'ACCOUNT_DELETE_FAILED',
    })
  }
}

export const PATCH = withTestingAudit(PATCHHandler)

export const DELETE = withTestingAudit(DELETEHandler)
