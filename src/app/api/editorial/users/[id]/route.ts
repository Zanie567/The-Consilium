import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

interface Props {
  params: Promise<{ id: string }>
}

function isEditorialStaff(role: string) {
  return role === 'ADMIN' || role === 'EDITOR'
}

async function getVerifiedRole(userId: string): Promise<string | null> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } })
    if (!u || !u.isActive) return null
    return u.role
  } catch {
    return null
  }
}

export async function GET(_req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError
  const callerRole = await getVerifiedRole(session!.user.id)
  if (!callerRole || !isEditorialStaff(callerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      slug: true, bio: true, image: true, createdAt: true, lastLoginAt: true, adminNotes: true,
      categoryAssignments: {
        select: { category: { select: { id: true, name: true, slug: true } } },
      },
      articles: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, slug: true, status: true,
          createdAt: true, publishedAt: true,
          category: { select: { name: true } },
        },
      },
    },
  })

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(user)
}

export async function PATCH(req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  const authError2 = requireActiveSession(session)
  if (authError2) return authError2
  const callerRole = await getVerifiedRole(session!.user.id)
  if (!callerRole || !isEditorialStaff(callerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  // Editors cannot modify Admin accounts
  if (callerRole === 'EDITOR') {
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } })
    if (target?.role === 'ADMIN') {
      return NextResponse.json({ error: 'Editors cannot modify Admin accounts.' }, { status: 403 })
    }
  }

  const body = await req.json()
  const { isActive, password, categoryIds, name, email, role, bio, image, slug, adminNotes } = body

  const updates: Record<string, unknown> = {}
  if (typeof isActive === 'boolean') updates.isActive = isActive
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (typeof email === 'string' && email.trim()) updates.email = email.trim().toLowerCase()
  if (typeof bio === 'string') updates.bio = bio.trim() || null
  if (typeof image === 'string') updates.image = image.trim() || null

  // Only admins can set adminNotes or change role to ADMIN
  if (callerRole === 'ADMIN') {
    if (typeof adminNotes === 'string') updates.adminNotes = adminNotes.trim() || null
    if (role && ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'].includes(role)) updates.role = role
  } else {
    // Editors can change role between EDITOR/WRITER/READER only
    if (role && ['EDITOR', 'WRITER', 'READER'].includes(role)) updates.role = role
  }

  if (typeof slug === 'string' && slug.trim()) {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const conflict = await prisma.user.findFirst({ where: { slug: clean, id: { not: id } } })
    if (conflict) {
      return NextResponse.json({ error: 'That slug is already taken by another user.' }, { status: 400 })
    }
    updates.slug = clean
  }

  if (password) {
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }
    updates.password = await bcrypt.hash(password, 10)
  }

  const user = await prisma.user.update({
    where: { id },
    data: updates,
    select: { id: true, name: true, role: true, isActive: true, slug: true, email: true, bio: true, image: true, adminNotes: true },
  })

  if (categoryIds !== undefined) {
    await prisma.categoryEditor.deleteMany({ where: { userId: id } })
    if (categoryIds.length > 0) {
      await prisma.categoryEditor.createMany({
        data: categoryIds.map((cid: string) => ({ userId: id, categoryId: cid })),
      })
    }
  }

  return NextResponse.json(user)
}

export async function DELETE(_req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  const authError3 = requireActiveSession(session)
  if (authError3) return authError3
  const callerRole = await getVerifiedRole(session!.user.id)
  if (!callerRole || !isEditorialStaff(callerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  // Editors cannot delete Admin accounts
  if (callerRole === 'EDITOR' && target.role === 'ADMIN') {
    return NextResponse.json({ error: 'Editors cannot delete Admin accounts.' }, { status: 403 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.articleNote.deleteMany({ where: { authorId: id } })
    await tx.article.deleteMany({ where: { authorId: id } })
    await tx.user.delete({ where: { id } })
  })

  return NextResponse.json({ ok: true })
}
