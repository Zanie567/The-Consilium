import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiServerErrorResponse } from '@/lib/apiResponse'

// GET /api/profile/stats - aggregate reading stats for the user
export async function GET() {
  const auth = await requireVerifiedSessionUser()
  if (!auth.ok) return auth.response
  const userId = auth.user.id

  try {
    const [
      totalRead,
      totalInProgress,
      totalDebateVotes,
      totalComments,
      totalSaved,
      progressRows,
      categoryRows,
    ] = await Promise.all([
      prisma.readingProgress.count({ where: { userId, completed: true } }),
      prisma.readingProgress.count({ where: { userId, completed: false, progress: { gt: 3 } } }),
      prisma.debateVote.count({ where: { userId } }),
      prisma.comment.count({ where: { userId, isHidden: false } }),
      prisma.bookmark.count({ where: { userId } }),
      // For reading streak: get dates of completed reads
      prisma.readingProgress.findMany({
        where: { userId, completed: true },
        select: { updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      // For favourite category: join through articles
      prisma.readingProgress.findMany({
        where: { userId, completed: true },
        include: {
          article: {
            select: { category: { select: { name: true } } },
          },
        },
      }),
    ])

    // Compute reading streak (consecutive calendar days)
    const days = new Set(progressRows.map((r) => r.updatedAt.toISOString().slice(0, 10)))
    let streak = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      if (days.has(key)) {
        streak++
      } else if (i > 0) {
        break
      }
    }

    // Favourite category
    const categoryCounts: Record<string, number> = {}
    for (const row of categoryRows) {
      const name = row.article.category?.name
      if (name) categoryCounts[name] = (categoryCounts[name] ?? 0) + 1
    }
    const favouriteCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    return NextResponse.json({
      totalRead,
      totalInProgress,
      totalDebateVotes,
      totalComments,
      totalSaved,
      readingStreak: streak,
      favouriteCategory,
      readingTimeSavedMins: totalRead * 5, // rough estimate: 5 min average
    })
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'profile/stats:load',
      userMessage: 'Your profile statistics could not be loaded because of a server error.',
      code: 'PROFILE_STATS_LOAD_FAILED',
    })
  }
}
