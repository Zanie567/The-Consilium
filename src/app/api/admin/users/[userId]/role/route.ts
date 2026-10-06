import { withTestingAudit } from '@/lib/testingAudit'
import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, roleChangedEmail } from '@/lib/email'
import { ADMIN_ONLY, ALL_ROLES, isAllowedRole } from '@/lib/rbac'
import { MembershipError, setMemberRole } from '@/lib/membership'

interface Ctx { params: Promise<{ userId: string }> }

async function PATCHHandler(req: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const adminId = admin.id

  if (userId === adminId) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
  }

  const { role } = await req.json()
  if (!isAllowedRole(role, ALL_ROLES)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const adminName = admin.name ?? admin.email ?? adminId

  // One path for every role change: updates users.role AND the membership record
  // (and the audit log) in a single transaction, and keeps the Meet the Team card.
  let oldRole: string
  try {
    ;({ oldRole } = await setMemberRole(admin, userId, role))
  } catch (error) {
    if (error instanceof MembershipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }

  // Auto-log the change as an admin note
  await prisma.adminNote.create({
    data: {
      userId,
      note: `Role changed from ${oldRole} to ${role} by ${adminName}`,
      authorId: adminId,
      authorName: adminName,
    },
  }).catch(() => {})

  // Email the user about role change
  const STAFF = ['WRITER', 'EDITOR', 'GROWTH', 'ADMIN']
  const promoted = STAFF.includes(role) && !STAFF.includes(oldRole)
  const emailContent = roleChangedEmail(target.name, role, promoted)
  sendEmail({ to: target.email, ...emailContent }).catch(() => {})

  return NextResponse.json({ ok: true, oldRole, newRole: role })
}

export const PATCH = withTestingAudit(PATCHHandler)
