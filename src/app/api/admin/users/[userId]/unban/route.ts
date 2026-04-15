import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, userUnbannedEmail } from '@/lib/email'

interface Ctx { params: Promise<{ userId: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = session.user.id
  const adminName = session.user.name ?? session.user.email ?? adminId

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  await prisma.user.update({
    where: { id: userId },
    data: {
      isBanned: false,
      bannedAt: null,
      bannedReason: null,
      bannedBy: null,
    },
  })

  await prisma.adminNote.create({
    data: {
      userId,
      note: `Account unbanned by ${adminName}`,
      authorId: adminId,
      authorName: adminName,
    },
  }).catch(() => {})

  await prisma.auditLog.create({
    data: {
      action: 'USER_UNBANNED',
      targetId: userId,
      targetType: 'user',
      performedBy: adminId,
      metadata: { adminName, targetName: target.name, targetEmail: target.email },
    },
  }).catch(() => {})

  const emailContent = userUnbannedEmail(target.name)
  sendEmail({ to: target.email, ...emailContent }).catch(() => {})

  return NextResponse.json({ ok: true })
}
