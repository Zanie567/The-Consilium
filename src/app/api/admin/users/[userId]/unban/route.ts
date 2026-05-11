import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, userUnbannedEmail } from '@/lib/email'
import { ADMIN_ONLY } from '@/lib/rbac'

interface Ctx { params: Promise<{ userId: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = admin.id
  const adminName = adminId

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
