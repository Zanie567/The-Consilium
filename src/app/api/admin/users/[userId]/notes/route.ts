import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Ctx { params: Promise<{ userId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string; isBanned?: boolean }).role !== 'ADMIN' || (session.user as { isBanned?: boolean }).isBanned) {
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
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string; isBanned?: boolean }).role !== 'ADMIN' || (session.user as { isBanned?: boolean }).isBanned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = session.user.id
  const adminName = session.user.name ?? session.user.email ?? adminId

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
