import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
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
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { isActive, password, categoryIds, name, email, role, bio, image, slug, adminNotes } = body

  const updates: Record<string, unknown> = {}
  if (typeof isActive === 'boolean') updates.isActive = isActive
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (typeof email === 'string' && email.trim()) updates.email = email.trim().toLowerCase()
  if (typeof bio === 'string') updates.bio = bio.trim() || null
  if (typeof image === 'string') updates.image = image.trim() || null
  if (typeof adminNotes === 'string') updates.adminNotes = adminNotes.trim() || null
  if (role && ['ADMIN', 'EDITOR', 'WRITER', 'READER'].includes(role)) updates.role = role

  if (typeof slug === 'string' && slug.trim()) {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    // Check uniqueness (exclude current user)
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

  // Update category assignments for editors
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
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.articleNote.deleteMany({ where: { authorId: id } })
    await tx.article.deleteMany({ where: { authorId: id } })
    await tx.user.delete({ where: { id } })
  })

  return NextResponse.json({ ok: true })
}
