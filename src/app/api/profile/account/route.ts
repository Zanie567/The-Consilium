import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'
import { apiServerErrorResponse } from '@/lib/apiResponse'

// PATCH /api/profile/account - update display name and bio
export async function PATCH(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  let body: { name?: unknown; bio?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'The request body is not valid JSON.' }, { status: 400 })
  }

  const { name, bio } = body
  if (name !== undefined && typeof name !== 'string') {
    return NextResponse.json({ error: 'name must be a string' }, { status: 400 })
  }
  if (bio !== undefined && typeof bio !== 'string') {
    return NextResponse.json({ error: 'bio must be a string' }, { status: 400 })
  }

  try {

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(typeof name === 'string' ? { name: name.trim() || null } : {}),
        ...(typeof bio === 'string' ? { bio: bio.trim() || null } : {}),
      },
      select: { id: true, name: true, bio: true },
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
