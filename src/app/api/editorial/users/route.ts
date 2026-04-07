import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

async function getVerifiedRole(userId: string): Promise<string | null> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } })
    if (!user || !user.isActive) return null
    return user.role
  } catch {
    return null
  }
}

function isEditorialStaff(role: string) {
  return role === 'ADMIN' || role === 'EDITOR'
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const role = await getVerifiedRole(session.user.id)
  if (!role || !isEditorialStaff(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } },
    select: {
      id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
      categoryAssignments: { select: { category: { select: { id: true, name: true, slug: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(users)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const role = await getVerifiedRole(session.user.id)
  if (!role || !isEditorialStaff(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, email, password, role, categoryIds, bio, slug: customSlug } = await req.json()
  if (!name?.trim() || !email?.trim() || !password || !role) {
    return NextResponse.json({ error: 'Name, email, password, and role are required.' }, { status: 400 })
  }

  // Editors can create EDITOR/WRITER accounts; only admins can create ADMIN accounts
  const allowedRoles = session.user.role === 'ADMIN'
    ? ['EDITOR', 'WRITER', 'ADMIN']
    : ['EDITOR', 'WRITER']

  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: session.user.role === 'ADMIN' ? 'Invalid role.' : 'Editors cannot create Admin accounts.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already in use.' }, { status: 400 })
  }

  const baseSlug = (customSlug?.trim()
    ? customSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  let slug = baseSlug
  let suffix = 1
  while (await prisma.user.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`
  }

  const hashed = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashed,
      role,
      slug,
      bio: bio?.trim() || null,
      ...(role === 'EDITOR' && categoryIds?.length
        ? {
            categoryAssignments: {
              create: categoryIds.map((id: string) => ({ categoryId: id })),
            },
          }
        : {}),
    },
    select: { id: true, name: true, email: true, role: true, slug: true },
  })

  return NextResponse.json(user, { status: 201 })
}
