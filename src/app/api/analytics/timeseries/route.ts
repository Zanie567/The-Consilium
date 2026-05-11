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
  return !!(user && user.isActive && !user.isBanned && ['ADMIN', 'GROWTH'].includes(user.role))
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
