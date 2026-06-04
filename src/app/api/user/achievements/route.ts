import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ACHIEVEMENT_TYPES } from '@/lib/constants'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/achievements
 *
 * All achievements for the current user, newest first. Each row carries a
 * resolved display title: the article title for first_publish, the series title
 * for series_complete.
 */
export async function GET() {
  const user = await getVerifiedSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const achievements = await prisma.writerAchievement.findMany({
      where: { userId: user.id },
      orderBy: { awardedAt: 'desc' },
    })

    // Resolve titles in two batched queries rather than one lookup per row.
    const articleIds = achievements.flatMap((a) =>
      a.type === ACHIEVEMENT_TYPES.FIRST_PUBLISH && a.referenceId ? [a.referenceId] : []
    )
    const seriesIds = achievements.flatMap((a) =>
      a.type === ACHIEVEMENT_TYPES.SERIES_COMPLETE && a.referenceId ? [a.referenceId] : []
    )

    const [articles, seriesList] = await Promise.all([
      articleIds.length
        ? prisma.article.findMany({
            where: { id: { in: articleIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as { id: string; title: string }[]),
      seriesIds.length
        ? prisma.series.findMany({
            where: { id: { in: seriesIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as { id: string; title: string }[]),
    ])

    const articleTitle = new Map(articles.map((a) => [a.id, a.title] as const))
    const seriesTitle = new Map(seriesList.map((s) => [s.id, s.title] as const))

    const result = achievements.map((a) => ({
      id: a.id,
      type: a.type,
      referenceId: a.referenceId,
      awardedAt: a.awardedAt.toISOString(),
      seenAt: a.seenAt?.toISOString() ?? null,
      title:
        a.type === ACHIEVEMENT_TYPES.FIRST_PUBLISH && a.referenceId
          ? articleTitle.get(a.referenceId) ?? null
          : a.type === ACHIEVEMENT_TYPES.SERIES_COMPLETE && a.referenceId
            ? seriesTitle.get(a.referenceId) ?? null
            : null,
    }))

    return NextResponse.json({ achievements: result })
  } catch (err) {
    console.error('[user/achievements] Error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
