import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'

// PATCH /api/profile/account - update display name and bio
export async function PATCH(request: NextRequest) {
  const user = await getVerifiedSessionUser(ALL_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { name, bio } = await request.json()

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(typeof name === 'string' ? { name: name.trim() || null } : {}),
        ...(typeof bio === 'string' ? { bio: bio.trim() || null } : {}),
      },
      select: { id: true, name: true, bio: true },
    })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  }
}

// DELETE /api/profile/account - permanently delete the account
export async function DELETE(request: NextRequest) {
  const user = await getVerifiedSessionUser(ALL_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { confirmEmail } = await request.json()
    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } })

    if (!confirmEmail || confirmEmail.toLowerCase() !== dbUser?.email.toLowerCase()) {
      return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
    }

    await prisma.user.delete({ where: { id: user.id } })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
