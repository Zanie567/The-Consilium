import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, getVerifiedSessionUser, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_PORTAL_ROLES } from '@/lib/rbac'

export async function GET() {
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError

  const notifications = await prisma.notification.findMany({
    where: { userId: session!.user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { article: { select: { slug: true } } },
  })

  return NextResponse.json(notifications)
}

export async function PATCH() {
  const user = await getVerifiedSessionUser(EDITORIAL_PORTAL_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  })

  return NextResponse.json({ ok: true })
}
