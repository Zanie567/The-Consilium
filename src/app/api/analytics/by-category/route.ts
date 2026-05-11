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

  const rows = await prisma.$queryRaw<{ category: string; views: bigint }[]>`
    SELECT COALESCE(c.name, 'Uncategorised') AS category,
           COUNT(av.id) AS views
    FROM article_views av
    JOIN articles a ON a.id = av."article_id"
    LEFT JOIN categories c ON c.id = a."category_id"
    GROUP BY 1
    ORDER BY views DESC
  `

  const total = rows.reduce((sum, r) => sum + Number(r.views), 0)

  return NextResponse.json(
    rows.map((r) => ({
      category: r.category,
      views: Number(r.views),
      percentage_of_total: total > 0 ? Math.round((Number(r.views) / total) * 1000) / 10 : 0,
    })),
  )
}
