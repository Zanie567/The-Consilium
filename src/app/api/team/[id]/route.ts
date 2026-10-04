import { withTestingAudit } from '@/lib/testingAudit'
import { TEAM_TIER_ORDER } from '@/lib/teamHierarchy'
import { NextResponse, NextRequest } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'
import { isUniqueViolation } from '@/lib/prismaErrors'
import { parseLinkTarget } from '../linkTarget'

async function PUTHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    const body = await request.json()
    const { name, role, bio, image, email, order, isActive, userId, publicTier } = body

    if (publicTier != null && publicTier !== '' && !TEAM_TIER_ORDER.includes(publicTier)) {
      return NextResponse.json({ error: 'Invalid public placement' }, { status: 400 })
    }
    const link = await parseLinkTarget(userId)
    if (!link.ok) return link.response

    const member = await prisma.teamMember.update({
      where: { id },
      data: {
        // Absent leaves the link as it is; null unlinks; an id links.
        ...(link.userId !== undefined ? { userId: link.userId } : {}),
        ...(publicTier !== undefined ? { publicTier: publicTier || null } : {}),
        name,
        // Missing preserves the appointment; explicit null clears the title.
        ...(role !== undefined ? { role: role ?? '' } : {}),
        ...(bio !== undefined ? { bio: bio || null } : {}),
        ...(image !== undefined ? { image: image || null } : {}),
        ...(email !== undefined ? { email: email || null } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    })
    return NextResponse.json(member)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'That account already has a team card.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update team member' }, { status: 500 })
  }
}

async function DELETEHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    await prisma.teamMember.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete team member' }, { status: 500 })
  }
}

export const PUT = withTestingAudit(PUTHandler)

export const DELETE = withTestingAudit(DELETEHandler)
