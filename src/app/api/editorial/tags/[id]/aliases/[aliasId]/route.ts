import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TAG_MANAGE_ROLES } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { removeTagAlias } from '@/lib/tags/manage'
import { tagRouteError } from '@/lib/tags/api'

/** DELETE: the name no longer finds this tag. Articles are not affected. Tag managers only. */
async function DELETEHandler(_request: Request, { params }: { params: Promise<{ id: string; aliasId: string }> }) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const { id, aliasId } = await params
  try {
    await removeTagAlias(prisma, id, aliasId, auth.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return tagRouteError(error, 'alias-remove')
  }
}

export const DELETE = withTestingAudit(DELETEHandler)
