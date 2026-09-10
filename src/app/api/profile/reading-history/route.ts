import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiServerErrorResponse } from '@/lib/apiResponse'

// GET /api/profile/reading-history?page=1
// Returns paginated completed articles (progress >= 90)
export async function GET(request: NextRequest) {
  const auth = await requireVerifiedSessionUser()
  if (!auth.ok) return auth.response
  const userId = auth.user.id

  const { searchParams } = new URL(request.url)
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const pageSize = 20

  try {
    const [rows, total] = await Promise.all([
      prisma.readingProgress.findMany({
        where: { userId, completed: true },
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
        where: { userId, completed: true },
      }),
    ])

    return NextResponse.json({
      items: rows,
      total,
      page,
      pages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'profile/reading-history:load',
      userMessage: 'Your reading history could not be loaded because of a server error.',
      code: 'READING_HISTORY_LOAD_FAILED',
    })
  }
}
