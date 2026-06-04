import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { ADMIN_ONLY, EDITORIAL_MANAGEMENT_ROLES, isRole } from '@/lib/rbac'

export async function GET() {
  const caller = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] } },
    select: {
      id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
      categoryAssignments: { select: { category: { select: { id: true, name: true, slug: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(users)
}

export async function POST(req: Request) {
  const caller = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, email, password, role, categoryIds, bio, slug: customSlug } = await req.json()
  if (!name?.trim() || !email?.trim() || !password || !role) {
    return NextResponse.json({ error: 'Name, email, password, and role are required.' }, { status: 400 })
  }

  if (!isRole(role)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
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
