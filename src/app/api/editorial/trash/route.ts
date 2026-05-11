import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

// GET /api/editorial/trash - list all soft-deleted articles, most recently deleted first
export async function GET() {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
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
