import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ARTICLE_MUTATION_ROLES, TAG_MANAGE_ROLES, isAllowedRole } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { MAX_ARTICLE_TAGS, RECOMMENDED_ARTICLE_TAGS } from '@/lib/tagIdentity'
import { createTag, listTagOptions } from '@/lib/tags/manage'
import { invalidBody, readJsonObject, tagRouteError } from '@/lib/tags/api'

/**
 * GET: the approved tags, with aliases and usage, for the article editor's tag selector. Anyone who
 * writes articles may read it. Retired tags are included (flagged) so an article that carries one can
 * label it; the selector never offers them.
 */
async function GETHandler() {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return auth.response
  try {
    const tags = await listTagOptions(prisma)
    return NextResponse.json(
      { tags, canManage: isAllowedRole(auth.user.role, TAG_MANAGE_ROLES), maxTags: MAX_ARTICLE_TAGS, recommended: RECOMMENDED_ARTICLE_TAGS },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return tagRouteError(error, 'list')
  }
}

/** POST { name, description? }: create an approved tag. Tag managers only. */
async function POSTHandler(request: Request) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  try {
    const tag = await createTag(prisma, { name: body.name, description: body.description }, auth.user.id)
    return NextResponse.json({ tag }, { status: 201 })
  } catch (error) {
    return tagRouteError(error, 'create')
  }
}

export const GET = withTestingAudit(GETHandler)
export const POST = withTestingAudit(POSTHandler)
