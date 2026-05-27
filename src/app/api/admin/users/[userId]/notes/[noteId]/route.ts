import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'

interface Ctx { params: Promise<{ userId: string; noteId: string }> }

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { noteId } = await params

  try {
    await prisma.adminNote.delete({ where: { id: noteId } })
  } catch {
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
