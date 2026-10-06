import { loadPublicTeam } from '@/lib/publicTeam'
import { withTestingAudit } from '@/lib/testingAudit'
import { TEAM_TIER_ORDER } from '@/lib/teamHierarchy'
import { NextResponse, NextRequest } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'
import { isUniqueViolation } from '@/lib/prismaErrors'
import { parseLinkTarget } from './linkTarget'

export async function GET() {
  try {
    const members = await loadPublicTeam()
    return NextResponse.json(members)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}

async function POSTHandler(request: NextRequest) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, role, bio, image, email, order, isActive, userId, publicTier } = body

    if (!name) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 })
    }

    if (publicTier != null && publicTier !== '' && !TEAM_TIER_ORDER.includes(publicTier)) {
      return NextResponse.json({ error: 'Invalid public placement' }, { status: 400 })
    }
    const link = await parseLinkTarget(userId)
    if (!link.ok) return link.response

    const member = await prisma.teamMember.create({
      data: {
        ...(link.userId ? { userId: link.userId } : {}),
        ...(publicTier !== undefined ? { publicTier: publicTier || null } : {}),
        name,
        // Role is optional: a member may sit on the masthead without a formal
        // title, and the public page renders no role line in that case. The
        // column is non-nullable, so "no role" is stored as an empty string.
        role: role ?? '',
        bio: bio || null,
        image: image || null,
        email: email || null,
        order: order ?? 0,
        isActive: isActive ?? true,
      },
    })
    return NextResponse.json(member, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'That account already has a team card.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create team member' }, { status: 500 })
  }
}

export const POST = withTestingAudit(POSTHandler)
