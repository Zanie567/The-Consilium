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

function classifyReferrer(referrer: string | null): string {
  if (!referrer) return 'Direct'
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '')
    if (host.includes('google')) return 'Google'
    if (host.includes('twitter') || host.includes('t.co') || host.includes('x.com')) return 'Twitter / X'
    if (host.includes('linkedin')) return 'LinkedIn'
    if (host.includes('facebook')) return 'Facebook'
    if (host.includes('instagram')) return 'Instagram'
    return host || 'Other'
  } catch {
    return 'Other'
  }
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') ?? '30', 10) || 30
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const views = await prisma.articleView.findMany({
    where: { viewedAt: { gte: since } },
    select: { referrer: true },
  })

  const counts = new Map<string, number>()
  for (const v of views) {
    const source = classifyReferrer(v.referrer)
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }

  const total = views.length
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([referrer, count]) => ({
      referrer,
      views: count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))

  return NextResponse.json(sorted)
}
