import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// PATCH /api/profile/account — update display name and bio
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError

  try {
    const { name, bio } = await request.json()

    const updated = await prisma.user.update({
      where: { id: session!.user.id },
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

// DELETE /api/profile/account — permanently delete the account
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const authError2 = requireActiveSession(session)
  if (authError2) return authError2

  try {
    const { confirmEmail } = await request.json()

    if (!confirmEmail || confirmEmail.toLowerCase() !== session!.user.email?.toLowerCase()) {
      return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
    }

    // Cascade deletes handle all related records
    await prisma.user.delete({ where: { id: session!.user.id } })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
