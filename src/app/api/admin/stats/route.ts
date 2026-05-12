import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'

// GET /api/admin/stats - overview stats for user management page
export async function GET() {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [total, activeThisWeek, banned, staffCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastActiveAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { isBanned: true } }),
    prisma.user.count({ where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'] } } }),
  ])

  return NextResponse.json({ total, activeThisWeek, banned, staffCount })
}
