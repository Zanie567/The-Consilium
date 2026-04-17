import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/admin/stats — overview stats for user management page
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string; isBanned?: boolean }).role !== 'ADMIN' || (session.user as { isBanned?: boolean }).isBanned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [total, activeThisWeek, banned, staffCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastActiveAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { isBanned: true } }),
    prisma.user.count({ where: { role: { in: ['WRITER', 'EDITOR', 'ADMIN'] } } }),
  ])

  return NextResponse.json({ total, activeThisWeek, banned, staffCount })
}
