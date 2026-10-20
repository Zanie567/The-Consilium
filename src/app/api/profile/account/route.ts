import { withTestingAudit } from '@/lib/testingAudit'
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'
import { MAX_BIO_LENGTH, MAX_NAME_LENGTH } from '@/lib/constants'
import { readDisplayTitles, validateDisplayTitles } from '@/lib/displayTitles'
import {
  ProfileSaveError,
  applySharedProfileChanges,
  parseExpectedValues,
  profileSaveErrorBody,
  releaseUnusedPhotos,
  type SharedChanges,
} from '@/lib/contributorProfile'
import { sharedProfileView } from '@/lib/profileFields'
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
// Name, bio and photo are shared with the caller's linked Meet the Team card: they are
// saved through contributorProfile.ts, which writes only the fields sent, to the account
// and the card together, and refuses a field whose `expected` value is out of date.
//
// displayTitles are labels, not permissions. Only an ADMIN may write them, checked
// here against the role on the verified session user; everyone else gets a 403.
const ALLOWED_KEYS = new Set(['name', 'bio', 'image', 'displayTitles', 'expected'])

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
  const expected = parseExpectedValues(body.expected)
  if (!expected) {
    return NextResponse.json({ error: 'expected may only map name, bio and image to text or null.' }, { status: 400 })
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

  // Only the fields sent are saved. A photo is validated inside the save, once the stored
  // ones are known: re-sending a photo already on the account or card is always accepted.
  const changes: SharedChanges = {}
  for (const [field, value] of [['name', name], ['bio', bio], ['image', image]] as const) {
    if (typeof value === 'string') {
      changes[field] = { value, ...(expected[field] !== undefined ? { expected: expected[field] } : {}) }
    }
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const shared = await applySharedProfileChanges(tx, {
        userId: user.id,
        changes,
        actor: { id: user.id, administrator: false },
        via: 'account',
        imageRule: 'own-upload',
        keepPublishedBio: true,
      })
      const titles = nextTitles !== undefined
        ? (await tx.user.update({ where: { id: user.id }, data: { displayTitles: nextTitles }, select: { displayTitles: true } })).displayTitles
        : (await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { displayTitles: true } })).displayTitles
      return { shared, titles }
    })

    // Only after both rows point at the new photo is the old one safe to delete, and only
    // if no account or card anywhere still uses it. Never throws.
    await releaseUnusedPhotos(saved.shared.previousPhotos, user.id)

    const { shared } = saved
    return NextResponse.json({
      id: user.id,
      ...shared.account,
      displayTitles: readDisplayTitles(saved.titles),
      profile: sharedProfileView(shared.account, shared.card, shared.linked),
    })
  } catch (error) {
    if (error instanceof ProfileSaveError) {
      return NextResponse.json(profileSaveErrorBody(error), { status: error.status })
    }
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
