import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

async function requireAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session) return false
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true, isBanned: true },
  })
  return !!(user && user.isActive && !user.isBanned && user.role === 'ADMIN')
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10) || 10, 100)
  const period = parseInt(searchParams.get('period') ?? '30', 10) || 30

  const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000)
  const prevSince = new Date(Date.now() - period * 2 * 24 * 60 * 60 * 1000)

  // Top articles by views in the period
  const rows = await prisma.$queryRawUnsafe<
    { article_id: string; views: bigint; prev_views: bigint }[]
  >(
    `SELECT av."article_id",
            COUNT(*) FILTER (WHERE av."viewed_at" >= $2)                          AS views,
            COUNT(*) FILTER (WHERE av."viewed_at" >= $3 AND av."viewed_at" < $2)  AS prev_views
     FROM article_views av
     WHERE av."viewed_at" >= $3
     GROUP BY av."article_id"
     ORDER BY views DESC
     LIMIT $1`,
    limit,
    since,
    prevSince,
  )

  if (rows.length === 0) return NextResponse.json([])

  const articleIds = rows.map((r) => r.article_id)
  const articles = await prisma.article.findMany({
    where: { id: { in: articleIds }, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      author: { select: { name: true } },
      category: { select: { name: true } },
    },
  })

  const articleMap = new Map(articles.map((a) => [a.id, a]))

  return NextResponse.json(
    rows.map((r, i) => {
      const article = articleMap.get(r.article_id)
      const views = Number(r.views)
      const prevViews = Number(r.prev_views)
      const trend = views > prevViews ? 'up' : views < prevViews ? 'down' : 'same'
      return {
        rank: i + 1,
        article_id: r.article_id,
        title: article?.title ?? '(deleted)',
        slug: article?.slug ?? null,
        author: article?.author?.name ?? null,
        category: article?.category?.name ?? null,
        views,
        views_last_period: prevViews,
        trend,
      }
    }),
  )
}
