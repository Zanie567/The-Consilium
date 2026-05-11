import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, userWarningEmail } from '@/lib/email'
import { ADMIN_ONLY } from '@/lib/rbac'

interface Ctx { params: Promise<{ userId: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = admin.id
  const adminName = adminId

  const { reason } = await req.json()
  if (!reason?.trim()) return NextResponse.json({ error: 'Reason is required' }, { status: 400 })

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const warning = await prisma.userWarning.create({
    data: {
      userId,
      reason: reason.trim(),
      issuedBy: adminName,
    },
  })

  await prisma.auditLog.create({
    data: {
      action: 'USER_WARNED',
      targetId: userId,
      targetType: 'user',
      performedBy: adminId,
      metadata: { reason: reason.trim(), adminName, targetName: target.name, targetEmail: target.email },
    },
  }).catch(() => {})

  // Email the user
  const emailContent = userWarningEmail(target.name, reason.trim())
  sendEmail({ to: target.email, ...emailContent }).catch(() => {})

  return NextResponse.json(warning)
}
