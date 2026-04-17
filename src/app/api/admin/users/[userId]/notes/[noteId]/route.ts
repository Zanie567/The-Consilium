import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Ctx { params: Promise<{ userId: string; noteId: string }> }

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string; isBanned?: boolean }).role !== 'ADMIN' || (session.user as { isBanned?: boolean }).isBanned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { noteId } = await params

  await prisma.adminNote.delete({ where: { id: noteId } }).catch(() => {})

  return NextResponse.json({ ok: true })
}
