import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/profile/reading-history?page=1
// Returns paginated completed articles (progress >= 90)
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const pageSize = 20

  try {
    const [rows, total] = await Promise.all([
      prisma.readingProgress.findMany({
        where: { userId: session.user.id, completed: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          article: {
            select: {
              id: true,
              title: true,
              slug: true,
              excerpt: true,
              coverImage: true,
              publishedAt: true,
              content: true,
              author: { select: { name: true } },
              category: { select: { name: true } },
            },
          },
        },
      }),
      prisma.readingProgress.count({
        where: { userId: session.user.id, completed: true },
      }),
    ])

    return NextResponse.json({
      items: rows,
      total,
      page,
      pages: Math.ceil(total / pageSize),
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch reading history' }, { status: 500 })
  }
}
