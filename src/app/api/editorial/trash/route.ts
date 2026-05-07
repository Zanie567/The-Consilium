import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/editorial/trash - list all soft-deleted articles, most recently deleted first
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const articles = await prisma.article.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        deletedAt: true,
        author: { select: { name: true } },
        category: { select: { name: true } },
      },
    })
    return NextResponse.json(articles)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch trash' }, { status: 500 })
  }
}
