import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/admin/audit-log - last 100 audit actions
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string; isBanned?: boolean }).role !== 'ADMIN' || (session.user as { isBanned?: boolean }).isBanned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json(logs)
}
