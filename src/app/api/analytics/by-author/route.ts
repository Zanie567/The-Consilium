import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

async function requireAdmin(): Promise<boolean> {
  return !!(await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES))
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await prisma.$queryRaw<
    { author_id: string; author_name: string; total_articles: bigint; total_views: bigint }[]
  >`
    SELECT a."author_id",
           u.name AS author_name,
           COUNT(DISTINCT a.id) AS total_articles,
           COALESCE(SUM(a."view_count"), 0) AS total_views
    FROM articles a
    JOIN users u ON u.id = a."author_id"
    WHERE a.status = 'PUBLISHED' AND a.deleted_at IS NULL
    GROUP BY a."author_id", u.name
    ORDER BY total_views DESC
  `

  if (rows.length === 0) return NextResponse.json([])

  const authorIds = rows.map((r) => r.author_id)

  // Best article per author by view count
  const bestArticles = await prisma.article.findMany({
    where: { authorId: { in: authorIds }, status: 'PUBLISHED', deletedAt: null },
    orderBy: { viewCount: 'desc' },
    select: { authorId: true, title: true, slug: true, viewCount: true },
  })

  // Keep the top article per author
  const bestByAuthor = new Map<string, { title: string; slug: string; views: number }>()
  for (const a of bestArticles) {
    if (!bestByAuthor.has(a.authorId)) {
      bestByAuthor.set(a.authorId, { title: a.title, slug: a.slug, views: a.viewCount })
    }
  }

  return NextResponse.json(
    rows.map((r, i) => {
      const totalArticles = Number(r.total_articles)
      const totalViews = Number(r.total_views)
      const best = bestByAuthor.get(r.author_id) ?? null
      return {
        rank: i + 1,
        author_id: r.author_id,
        author_name: r.author_name,
        total_articles: totalArticles,
        total_views: totalViews,
        avg_views_per_article: totalArticles > 0 ? Math.round(totalViews / totalArticles) : 0,
        most_viewed_article: best,
      }
    }),
  )
}
