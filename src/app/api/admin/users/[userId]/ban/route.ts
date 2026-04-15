import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, userBannedEmail } from '@/lib/email'

interface Ctx { params: Promise<{ userId: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = session.user.id

  if (userId === adminId) {
    return NextResponse.json({ error: 'Cannot ban yourself' }, { status: 400 })
  }

  const { reason } = await req.json()
  if (!reason?.trim()) return NextResponse.json({ error: 'Reason is required' }, { status: 400 })

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (target.role === 'ADMIN') {
    return NextResponse.json({ error: 'Cannot ban admin accounts' }, { status: 400 })
  }

  const adminName = session.user.name ?? session.user.email ?? adminId

  await prisma.user.update({
    where: { id: userId },
    data: {
      isBanned: true,
      bannedAt: new Date(),
      bannedReason: reason.trim(),
      bannedBy: adminId,
    },
  })

  // Invalidate all active sessions by deleting DB sessions (covers non-JWT session fallback)
  await prisma.session.deleteMany({ where: { userId } }).catch(() => {})

  await prisma.auditLog.create({
    data: {
      action: 'USER_BANNED',
      targetId: userId,
      targetType: 'user',
      performedBy: adminId,
      metadata: { reason: reason.trim(), adminName, targetName: target.name, targetEmail: target.email },
    },
  }).catch(() => {})

  const emailContent = userBannedEmail(target.name, reason.trim())
  sendEmail({ to: target.email, ...emailContent }).catch(() => {})

  return NextResponse.json({ ok: true })
}
