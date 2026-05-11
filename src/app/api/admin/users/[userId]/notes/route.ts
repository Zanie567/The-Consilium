import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'

interface Ctx { params: Promise<{ userId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const notes = await prisma.adminNote.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, note: true, authorId: true, authorName: true, createdAt: true },
  })

  return NextResponse.json(notes)
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = admin.id
  const adminName = adminId

  const { note } = await req.json()
  if (!note?.trim()) return NextResponse.json({ error: 'Note is required' }, { status: 400 })

  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!exists) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const created = await prisma.adminNote.create({
    data: {
      userId,
      note: note.trim(),
      authorId: adminId,
      authorName: adminName,
    },
    select: { id: true, note: true, authorId: true, authorName: true, createdAt: true },
  })

  return NextResponse.json(created)
}
