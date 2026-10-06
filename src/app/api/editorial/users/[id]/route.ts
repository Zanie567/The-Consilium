import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { validateDisplayTitles } from '@/lib/displayTitles'
import { ADMIN_ONLY, isRole } from '@/lib/rbac'
interface Props {
  params: Promise<{ id: string }>
}

const ADMIN_PROFILE_FIELDS = new Set(['name', 'email', 'bio', 'image', 'slug', 'adminNotes', 'isActive', 'categoryIds', 'displayTitles'])

function bodyKeys(body: Record<string, unknown>) {
  return Object.keys(body).filter((key) => body[key] !== undefined)
}

function hasOnlyKeys(keys: string[], allowed: Set<string>) {
  return keys.every((key) => allowed.has(key))
}

export async function GET(_req: Request, { params }: Props) {
  const caller = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      slug: true, bio: true, image: true, createdAt: true, lastLoginAt: true, adminNotes: true, displayTitles: true,
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

async function PATCHHandler(req: Request, { params }: Props) {
  const caller = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, name: true, email: true, displayTitles: true },
  })
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  const body = await req.json() as Record<string, unknown>
  const keys = bodyKeys(body)
  const { isActive, password, categoryIds, name, email, role, bio, image, slug, adminNotes, displayTitles } = body

  const isRoleChange = role !== undefined
  const isPasswordChange = password !== undefined
  if ([isRoleChange, isPasswordChange].filter(Boolean).length > 1) {
    return NextResponse.json({ error: 'Submit role changes and password changes separately.' }, { status: 400 })
  }

  if (isRoleChange && keys.length !== 1) {
    return NextResponse.json({ error: 'Role changes must only include role.' }, { status: 400 })
  }
  if (isPasswordChange && keys.length !== 1) {
    return NextResponse.json({ error: 'Password resets must only include password.' }, { status: 400 })
  }

  const allowedProfileFields = ADMIN_PROFILE_FIELDS
  if (!isRoleChange && !isPasswordChange && !hasOnlyKeys(keys, allowedProfileFields)) {
    return NextResponse.json({ error: 'Request includes fields you cannot update.' }, { status: 400 })
  }

  if (categoryIds !== undefined) {
    if (!Array.isArray(categoryIds) || categoryIds.some((id) => typeof id !== 'string' || !id)) {
      return NextResponse.json({ error: 'categoryIds must be an array of category IDs.' }, { status: 400 })
    }
    if (new Set(categoryIds).size !== categoryIds.length) {
      return NextResponse.json({ error: 'categoryIds must not contain duplicates.' }, { status: 400 })
    }
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true } })
    if (categories.length !== categoryIds.length) {
      return NextResponse.json({ error: 'One or more categories no longer exist.' }, { status: 400 })
    }
  }

  const categorySelection = categoryIds as string[] | undefined
  const updates: Record<string, unknown> = {}
  if (typeof isActive === 'boolean') updates.isActive = isActive
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (typeof email === 'string' && email.trim()) updates.email = email.trim().toLowerCase()
  if (typeof bio === 'string') updates.bio = bio.trim() || null
  if (typeof image === 'string') updates.image = image.trim() || null

  if (typeof adminNotes === 'string') updates.adminNotes = adminNotes.trim() || null
  if (role && isRole(role)) updates.role = role

  // Display titles are labels. Writing them never touches `role`, and the check
  // against the allowed list happens here, not in the UI.
  if (displayTitles !== undefined) {
    const result = validateDisplayTitles(displayTitles)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    updates.displayTitles = result.titles
  }

  if (typeof slug === 'string' && slug.trim()) {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const conflict = await prisma.user.findFirst({ where: { slug: clean, id: { not: id } } })
    if (conflict) {
      return NextResponse.json({ error: 'That slug is already taken by another user.' }, { status: 400 })
    }
    updates.slug = clean
  }

  if (password !== undefined) {
    if (caller.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only admins can reset passwords.' }, { status: 403 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }
    updates.password = await bcrypt.hash(password, 10)
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: updates,
      select: { id: true, name: true, role: true, isActive: true, slug: true, email: true, bio: true, image: true, adminNotes: true, displayTitles: true },
    })

    if (updates.role && updates.role !== target.role) {
      await tx.auditLog.create({
        data: {
          action: 'USER_ROLE_CHANGED',
          targetId: id,
          targetType: 'user',
          performedBy: caller.id,
          metadata: {
            oldRole: target.role,
            newRole: updates.role,
            targetName: target.name,
            targetEmail: target.email,
          },
        },
      })
    }

    if (updates.displayTitles) {
      await tx.auditLog.create({
        data: {
          action: 'USER_DISPLAY_TITLES_CHANGED',
          targetId: id,
          targetType: 'user',
          performedBy: caller.id,
          metadata: {
            oldTitles: target.displayTitles,
            newTitles: updates.displayTitles,
            targetName: target.name,
            targetEmail: target.email,
          },
        },
      })
    }

    if (categorySelection !== undefined) {
      await tx.categoryEditor.deleteMany({ where: { userId: id } })
      if (categorySelection.length > 0) {
        await tx.categoryEditor.createMany({ data: categorySelection.map((categoryId: string) => ({ userId: id, categoryId })) })
      }
    }
    return updated
  })

  return NextResponse.json(user)
}

async function DELETEHandler(_req: Request, { params }: Props) {
  const caller = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  if (target.role === 'ADMIN') {
    return NextResponse.json({ error: 'Cannot delete Admin accounts.' }, { status: 403 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.articleNote.deleteMany({ where: { authorId: id } })
    await tx.article.deleteMany({ where: { authorId: id } })
    await tx.user.delete({ where: { id } })
  })

  return NextResponse.json({ ok: true })
}

export const PATCH = withTestingAudit(PATCHHandler)

export const DELETE = withTestingAudit(DELETEHandler)
