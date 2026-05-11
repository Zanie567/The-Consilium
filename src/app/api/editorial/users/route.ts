import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { ALL_ROLES, EDITORIAL_MANAGEMENT_ROLES, EDITOR_USER_TARGET_ROLES, isAllowedRole } from '@/lib/rbac'

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
  const caller = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, email, password, role, categoryIds, bio, slug: customSlug } = await req.json()
  if (!name?.trim() || !email?.trim() || !password || !role) {
    return NextResponse.json({ error: 'Name, email, password, and role are required.' }, { status: 400 })
  }

  const allowedRoles = caller.role === 'ADMIN' ? ALL_ROLES : EDITOR_USER_TARGET_ROLES

  if (!isAllowedRole(role, allowedRoles)) {
    return NextResponse.json({ error: caller.role === 'ADMIN' ? 'Invalid role.' : 'Editors can only create writer or reader accounts.' }, { status: 400 })
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
