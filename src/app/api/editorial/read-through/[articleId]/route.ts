import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { READ_THROUGH_ACCESS_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { getArticleReadThrough } from '@/lib/read-through'

/**
 * GET /api/editorial/read-through/[articleId]
 *
 * Full read-through breakdown for one published article: reader count,
 * completion rate, median furthest progress, decile retention, steepest drop.
 *
 * Ownership is enforced server-side: a non-admin asking about an article they
 * do not own gets the same 404 as a missing article, so the endpoint cannot
 * be used to probe other writers' numbers.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const user = await getVerifiedSessionUser(READ_THROUGH_ACCESS_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { articleId } = await params

  try {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        title: true,
        slug: true,
        authorId: true,
        status: true,
        deletedAt: true,
        publishedAt: true,
        viewCount: true,
      },
    })

    const visible = article && article.status === 'PUBLISHED' && article.deletedAt === null
    const owned = article && (article.authorId === user.id || user.role === 'ADMIN')
    if (!visible || !owned) {
      return NextResponse.json({ error: 'Article not found.' }, { status: 404 })
    }

    const stats = await getArticleReadThrough(article.id)

    return NextResponse.json({
      article: {
        id: article.id,
        title: article.title,
        slug: article.slug,
        publishedAt: article.publishedAt,
        viewCount: article.viewCount,
      },
      stats,
    })
  } catch (err) {
    console.error('[editorial/read-through/[articleId]/GET]', err)
    return NextResponse.json({ error: 'Failed to load reader data.' }, { status: 500 })
  }
}
