import { loadPublicTeam } from '@/lib/publicTeam'
import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse, NextRequest } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { createCard } from '@/lib/teamCards'
import { readJsonObject, teamCardErrorResponse } from '@/lib/teamCardRoutes'

export async function GET() {
  try {
    const members = await loadPublicTeam()
    return NextResponse.json(members)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}

// Administrators only. The body keeps its original shape (name, role, bio, image, email,
// order, isActive, userId, publicTier); the rules (one card per account, linkable accounts
// only, no silent duplicates) live in src/lib/teamCards.ts.
async function POSTHandler(request: NextRequest) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await readJsonObject(request)
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  try {
    const card = await createCard(admin, {
      name: body.name,
      // Role is optional: a member may sit on the masthead without a formal title, and the
      // public page renders no role line in that case.
      position: body.position ?? body.role,
      publicTier: body.publicTier,
      bio: body.bio,
      image: body.image,
      email: body.email,
      order: body.order,
      visible: body.visible ?? body.isActive,
      userId: body.userId,
      allowDuplicateName: body.allowDuplicateName,
    })
    return NextResponse.json(card, { status: 201 })
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:create')
  }
}

export const POST = withTestingAudit(POSTHandler)
