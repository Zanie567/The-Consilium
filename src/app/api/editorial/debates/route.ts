import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { apiServerErrorResponse } from '@/lib/apiResponse'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { FEATURED_DEBATE_LOCK, revalidateDebateSurfaces } from '@/lib/debateLifecycle'
import { loadDebateAdminRows } from '@/lib/debateAdminQueries'
import { slugFromTitle, uniqueSlug } from '@/lib/articleSlug'

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


  // Both articles, the debate and the "only one featured debate" switch commit together:
  // a failure part-way must not leave a deactivated featured debate or an orphan article.
  let created: { debate: Awaited<ReturnType<typeof prisma.debate.create>>; forArticle: { id: string }; againstArticle: { id: string } }
  try {
    created = await prisma.$transaction(async (tx) => {
      // Both articles are published immediately, so they get their permanent, title-based addresses now
      // (src/lib/articleSlug.ts: unique across articles, trashed articles and retired addresses).
      const base = (title: string, fallback: string) => slugFromTitle(title).length >= 3 ? slugFromTitle(title) : fallback
      const forSlug = await uniqueSlug(tx, base(forTitle, 'debate-for'))
      let againstSlug = await uniqueSlug(tx, base(againstTitle, 'debate-against'))
      if (againstSlug === forSlug) againstSlug = await uniqueSlug(tx, `${forSlug}-against`)

      if (isActive) {
        // Serialized with the edit route's featuring (see FEATURED_DEBATE_LOCK); only the featured row changes.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${FEATURED_DEBATE_LOCK}))`
        await tx.debate.updateMany({ where: { isActive: true }, data: { isActive: false } })
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
  await revalidateDebateSurfaces()

  return NextResponse.json({ debate, forArticle, againstArticle }, { status: 201 })
}

export const POST = withTestingAudit(POSTHandler)
