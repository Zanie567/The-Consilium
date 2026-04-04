import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const members = await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    return Response.json(members)
  } catch {
    return Response.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, role, bio, image, email, order, isActive } = body

    if (!name || !role) {
      return Response.json({ error: 'Name and role required' }, { status: 400 })
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
    return Response.json(member, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to create team member' }, { status: 500 })
  }
}
