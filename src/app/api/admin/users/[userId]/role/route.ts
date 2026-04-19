import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, roleChangedEmail } from '@/lib/email'

interface Ctx { params: Promise<{ userId: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string; isBanned?: boolean }).role !== 'ADMIN' || (session.user as { isBanned?: boolean }).isBanned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = session.user.id

  if (userId === adminId) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
  }

  const { role } = await req.json()
  if (!['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const oldRole = target.role
  const adminName = session.user.name ?? session.user.email ?? adminId

  await prisma.user.update({
    where: { id: userId },
    data: { role },
  })

  // Auto-log the change as an admin note
  await prisma.adminNote.create({
    data: {
      userId,
      note: `Role changed from ${oldRole} to ${role} by ${adminName}`,
      authorId: adminId,
      authorName: adminName,
    },
  }).catch(() => {})

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'USER_ROLE_CHANGED',
      targetId: userId,
      targetType: 'user',
      performedBy: adminId,
      metadata: { oldRole, newRole: role, adminName, targetName: target.name, targetEmail: target.email },
    },
  }).catch(() => {})

  // Email the user about role change
  const promoted = ['WRITER', 'EDITOR', 'ADMIN'].includes(role) && !['WRITER', 'EDITOR', 'ADMIN'].includes(oldRole)
  const emailContent = roleChangedEmail(target.name, role, promoted)
  sendEmail({ to: target.email, ...emailContent }).catch(() => {})

  return NextResponse.json({ ok: true, oldRole, newRole: role })
}
