import { NextResponse, NextRequest } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'

export async function GET() {
  try {
    const members = await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    return NextResponse.json(members)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, role, bio, image, email, order, isActive } = body

    if (!name || !role) {
      return NextResponse.json({ error: 'Name and role required' }, { status: 400 })
    }

    const member = await prisma.teamMember.create({
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
    return NextResponse.json(member, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create team member' }, { status: 500 })
  }
}
