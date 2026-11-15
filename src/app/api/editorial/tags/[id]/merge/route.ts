import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TAG_MANAGE_ROLES } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { mergeTags, previewMerge, undoMerge } from '@/lib/tags/manage'
import { invalidBody, readJsonObject, refreshPublicTagPages, tagRouteError } from '@/lib/tags/api'

interface Props {
  params: Promise<{ id: string }>
}

/** GET ?into=<tagId>: how many articles the merge would move (for the confirmation). */
async function GETHandler(request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const { id } = await params
  const into = new URL(request.url).searchParams.get('into')
  if (!into) return invalidBody()
  try {
    return NextResponse.json(await previewMerge(prisma, id, into))
  } catch (error) {
    return tagRouteError(error, 'merge-preview')
  }
}

/** POST { into }: merge this tag into another (its page then redirects there). Tag managers only. */
async function POSTHandler(request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await readJsonObject(request)
  if (!body || typeof body.into !== 'string' || !body.into) return invalidBody()
  try {
    const result = await mergeTags(prisma, id, body.into, auth.user.id)
    await refreshPublicTagPages()
    return NextResponse.json(result)
  } catch (error) {
    return tagRouteError(error, 'merge')
  }
}

/** DELETE: undo this tag's most recent merge, from the audit record. Tag managers only. */
async function DELETEHandler(_request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const { id } = await params
  try {
    const result = await undoMerge(prisma, id, auth.user.id)
    await refreshPublicTagPages()
    return NextResponse.json(result)
  } catch (error) {
    return tagRouteError(error, 'unmerge')
  }
}

export const GET = withTestingAudit(GETHandler)
export const POST = withTestingAudit(POSTHandler)
export const DELETE = withTestingAudit(DELETEHandler)
