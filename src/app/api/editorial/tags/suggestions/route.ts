import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { suggestTag } from '@/lib/tags/manage'
import { invalidBody, readJsonObject, tagRouteError } from '@/lib/tags/api'

/**
 * POST { name, note?, articleId? }: propose a new tag for review. Anyone who writes articles.
 * 200 { existing } when the wording already names a tag (choose that one instead);
 * 201 { suggestion } when it was recorded (or was already pending from this person).
 */
async function POSTHandler(request: Request) {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return auth.response
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  try {
    const result = await suggestTag(prisma, { name: body.name, note: body.note, articleId: body.articleId }, auth.user)
    return NextResponse.json(result, { status: 'existing' in result ? 200 : 201 })
  } catch (error) {
    return tagRouteError(error, 'suggest')
  }
}

export const POST = withTestingAudit(POSTHandler)
