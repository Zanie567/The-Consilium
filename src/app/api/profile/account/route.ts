import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'
import { MAX_BIO_LENGTH } from '@/lib/constants'
import { validateAvatarUrl } from '@/lib/avatarUrl'
import { apiServerErrorResponse } from '@/lib/apiResponse'

// PATCH /api/profile/account - update the caller's own display name, bio and
// profile image.
//
// Deliberately NOT editable here: role, email, isActive, isBanned, slug. Role in
// particular is admin-only (PATCH /api/editorial/users/[id], which requires ADMIN
// and logs the change) — a user must never be able to promote themselves by
// posting a role alongside their bio. Unknown keys in the body are ignored
// because every field below is picked out by name.
export async function PATCH(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  let body: { name?: unknown; bio?: unknown; image?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'The request body is not valid JSON.' }, { status: 400 })
  }

  // `null` is valid JSON, and destructuring it throws — which would surface as a
  // 500 rather than the 400 this is.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'The request body must be a JSON object.' }, { status: 400 })
  }

  const { name, bio, image } = body
  if (name !== undefined && typeof name !== 'string') {
    return NextResponse.json({ error: 'name must be a string' }, { status: 400 })
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
  // Only a file in our own avatars bucket is accepted — see validateAvatarUrl for
  // why an arbitrary URL from a user is not safe to store and render publicly.
  let nextImage: string | null | undefined
  if (typeof image === 'string') {
    const result = validateAvatarUrl(image)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    nextImage = result.url
  }

  try {

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(typeof name === 'string' ? { name: name.trim() || null } : {}),
        ...(typeof bio === 'string' ? { bio: bio.trim() || null } : {}),
        ...(nextImage !== undefined ? { image: nextImage } : {}),
      },
      select: { id: true, name: true, bio: true, image: true },
    })

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
export async function DELETE(request: NextRequest) {
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
