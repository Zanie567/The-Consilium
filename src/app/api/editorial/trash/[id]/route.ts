import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ id: string }>
}

// PATCH /api/editorial/trash/[id] - restore a soft-deleted article
export async function PATCH(_req: NextRequest, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  try {
    const article = await prisma.article.findUnique({ where: { id } })
    if (!article || !article.deletedAt) {
      return NextResponse.json({ error: 'Not found in trash' }, { status: 404 })
    }

    const restored = await prisma.article.update({
      where: { id },
      data: { deletedAt: null },
    })
    return NextResponse.json(restored)
  } catch {
    return NextResponse.json({ error: 'Failed to restore article' }, { status: 500 })
  }
}

// DELETE /api/editorial/trash/[id] - permanently delete a trashed article
export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  try {
    const article = await prisma.article.findUnique({ where: { id } })
    if (!article || !article.deletedAt) {
      return NextResponse.json({ error: 'Not found in trash' }, { status: 404 })
    }

    await prisma.article.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to permanently delete article' }, { status: 500 })
  }
}
