import { NextResponse, NextRequest } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    const body = await request.json()
    const { name, role, bio, image, email, order, isActive } = body

    const member = await prisma.teamMember.update({
      where: { id },
      data: {
        name,
        role,
        bio: bio || null,
        image: image || null,
        email: email || null,
        order: order ?? 0,
        isActive: isActive ?? true,
      },
    })
    return NextResponse.json(member)
  } catch {
    return NextResponse.json({ error: 'Failed to update team member' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    await prisma.teamMember.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete team member' }, { status: 500 })
  }
}
