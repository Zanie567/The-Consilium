import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/profile/stats — aggregate reading stats for the user
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      prisma.readingProgress.count({ where: { userId: session.user.id, completed: true } }),
      prisma.readingProgress.count({ where: { userId: session.user.id, completed: false, progress: { gt: 3 } } }),
      prisma.debateVote.count({ where: { userId: session.user.id } }),
      prisma.comment.count({ where: { userId: session.user.id, isHidden: false } }),
      prisma.bookmark.count({ where: { userId: session.user.id } }),
      // For reading streak: get dates of completed reads
      prisma.readingProgress.findMany({
        where: { userId: session.user.id, completed: true },
        select: { updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      // For favourite category: join through articles
      prisma.readingProgress.findMany({
        where: { userId: session.user.id, completed: true },
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
  } catch {
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
