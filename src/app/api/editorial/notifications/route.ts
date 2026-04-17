import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
  const session = await getServerSession(authOptions)
  const authError2 = requireActiveSession(session)
  if (authError2) return authError2

  await prisma.notification.updateMany({
    where: { userId: session!.user.id, read: false },
    data: { read: true },
  })

  return NextResponse.json({ ok: true })
}
