import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

export async function GET() {
  const user = await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const subscribers = await prisma.subscriber.findMany({
    orderBy: { subscribedAt: 'desc' },
    select: { id: true, email: true, subscribedAt: true },
  })

  return NextResponse.json({ subscribers })
}
