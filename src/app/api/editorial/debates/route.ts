import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { apiServerErrorResponse } from '@/lib/apiResponse'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { revalidateDebateSurfaces } from '@/lib/debateLifecycle'
import { loadDebateAdminRows } from '@/lib/debateAdminQueries'

export async function GET() {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  try {
    return NextResponse.json({ rows: await loadDebateAdminRows() })
  } catch (error) {
    console.error('[debate] list failed', error)
    return NextResponse.json({ error: 'The debate list could not be loaded.' }, { status: 500 })
  }
}

async function POSTHandler(req: Request) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json()
  const {
    title,
    description,
    isActive,
    closesAt,
    forTitle, forContent, forExcerpt, forAuthorId,
    againstTitle, againstContent, againstExcerpt, againstAuthorId,
    categoryId,
  } = body

  if (!title || !forTitle || !forContent || !againstTitle || !againstContent || !forAuthorId || !againstAuthorId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Slugify helper
  function toSlug(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  }

  // Both articles, the debate and the "only one featured debate" switch commit together:
  // a failure part-way must not leave a deactivated featured debate or an orphan article.
  let created: { debate: Awaited<ReturnType<typeof prisma.debate.create>>; forArticle: { id: string }; againstArticle: { id: string } }
  try {
    created = await prisma.$transaction(async (tx) => {
      async function uniqueSlug(base: string, taken: string[] = []) {
        let slug = base
        let i = 0
        while (taken.includes(slug) || await tx.article.findUnique({ where: { slug } })) {
          i++
          slug = `${base}-${i}`
        }
        return slug
      }
      const forSlug = await uniqueSlug(toSlug(forTitle))
      const againstSlug = await uniqueSlug(toSlug(againstTitle), [forSlug])

      if (isActive) {
        await tx.debate.updateMany({ data: { isActive: false } })
      }
      const common = { status: 'PUBLISHED' as const, publishedAt: new Date(), isDebate: true, categoryId: categoryId || null }
      const forArticle = await tx.article.create({
        data: { ...common, title: forTitle, slug: forSlug, content: forContent, excerpt: forExcerpt || null, authorId: forAuthorId },
    })
    const againstArticle = await tx.article.create({
      data: { ...common, title: againstTitle, slug: againstSlug, content: againstContent, excerpt: againstExcerpt || null, authorId: againstAuthorId },
    })
    const debate = await tx.debate.create({
      data: {
        title,
        description: description || null,
        forArticleId: forArticle.id,
        againstArticleId: againstArticle.id,
        isActive: isActive ?? false,
        closesAt: closesAt ? new Date(closesAt) : null,
      },
    })
    return { debate, forArticle, againstArticle }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json({ error: 'Choose existing authors and a valid category. Nothing was created.' }, { status: 400 })
    }
    return apiServerErrorResponse(error, {
      operation: 'debate:create',
      userMessage: 'The debate could not be created. Nothing was saved. Try again.',
      code: 'DEBATE_CREATE_FAILED',
    })
  }
  const { debate, forArticle, againstArticle } = created

  await prisma.auditLog.create({
    data: { action: 'DEBATE_CREATED', targetId: debate.id, targetType: 'debate', performedBy: user.id, metadata: { title: debate.title, forArticleId: forArticle.id, againstArticleId: againstArticle.id } },
  }).catch((error) => console.error('[debate] create audit failed', error))
  revalidateDebateSurfaces()

  return NextResponse.json({ debate, forArticle, againstArticle }, { status: 201 })
}

export const POST = withTestingAudit(POSTHandler)
