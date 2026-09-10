import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

export async function GET(req: Request) {
  const auth = await requireVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10) || 30, 365)
  const granularity = searchParams.get('granularity') ?? 'day'

  const since = days === 0
    ? new Date(0) // all time
    : new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  let truncFn: string
  if (granularity === 'week') truncFn = 'week'
  else if (granularity === 'month') truncFn = 'month'
  else truncFn = 'day'

  const rows = await prisma.$queryRawUnsafe<{ date: Date; views: bigint }[]>(
    `SELECT date_trunc($1, "viewed_at" AT TIME ZONE 'UTC') AS date,
            COUNT(*) AS views
     FROM article_views
     WHERE "viewed_at" >= $2
     GROUP BY 1
     ORDER BY 1 ASC`,
    truncFn,
    since,
  )

  return NextResponse.json(
    rows.map((r) => ({
      date: r.date.toISOString(),
      views: Number(r.views),
    })),
  )
}
