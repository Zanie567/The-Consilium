import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse, NextRequest } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { deleteCard, updateCard } from '@/lib/teamCards'
import { parseOwnerField, readJsonObject, teamCardErrorResponse } from '@/lib/teamCardRoutes'

// Administrators only. Edits the public card; the owner changes only when `userId` is sent
// (absent leaves it, null unlinks, an id links) and the whole edit commits or none of it does.
async function PUTHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await readJsonObject(request)
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const owner = parseOwnerField(body.userId)
  if (!owner.ok) return NextResponse.json({ error: 'userId must be a string', code: 'INVALID_FIELD' }, { status: 400 })
  if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== 'string') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    const card = await updateCard(
      admin,
      id,
      {
        name: body.name,
        // Missing preserves the appointment; explicit null clears the title.
        position: body.position ?? body.role,
        publicTier: body.publicTier,
        bio: body.bio,
        image: body.image,
        email: body.email,
        order: body.order,
        visible: body.visible ?? body.isActive,
      },
      { expectedUpdatedAt: body.expectedUpdatedAt as string | undefined, userId: owner.userId },
    )
    return NextResponse.json(card)
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:update')
  }
}

async function DELETEHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await readJsonObject(request)
  try {
    await deleteCard(admin, id, { expectedUpdatedAt: typeof body?.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined })
    return NextResponse.json({ success: true })
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:delete')
  }
}

export const PUT = withTestingAudit(PUTHandler)

export const DELETE = withTestingAudit(DELETEHandler)
