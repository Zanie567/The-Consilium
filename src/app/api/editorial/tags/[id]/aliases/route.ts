import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TAG_MANAGE_ROLES } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { addTagAlias } from '@/lib/tags/manage'
import { invalidBody, readJsonObject, tagRouteError } from '@/lib/tags/api'

/** POST { name }: another name that finds this tag. Tag managers only. */
async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  try {
    return NextResponse.json({ alias: await addTagAlias(prisma, id, body.name, auth.user.id) }, { status: 201 })
  } catch (error) {
    return tagRouteError(error, 'alias-add')
  }
}

export const POST = withTestingAudit(POSTHandler)
