import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { READ_THROUGH_ACCESS_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { EMPTY_LIST_STATS, getReadStatsByArticleIds } from '@/lib/read-through'

/**
 * GET /api/editorial/read-through
 *
 * The caller's published articles with aggregate signed-in reader stats
 * (reader count, completion rate, median furthest progress).
 *
 * Ownership is enforced here, not in the UI: non-admins always get their own
 * articles. Only ADMIN may pass ?authorId= to view another author's list.
 */
export async function GET(req: NextRequest) {
  const user = await getVerifiedSessionUser(READ_THROUGH_ACCESS_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestedAuthorId = req.nextUrl.searchParams.get('authorId')
  let authorId = user.id
  if (requestedAuthorId && requestedAuthorId !== user.id) {
    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'You can only view reader data for your own articles.' },
        { status: 403 }
      )
    }
    authorId = requestedAuthorId
  }

  try {
    const articles = await prisma.article.findMany({
      where: { authorId, status: 'PUBLISHED', deletedAt: null },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, title: true, slug: true, publishedAt: true, viewCount: true },
    })

    const statsById = await getReadStatsByArticleIds(articles.map((a) => a.id))

    return NextResponse.json({
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        publishedAt: a.publishedAt,
        viewCount: a.viewCount,
        ...(statsById.get(a.id) ?? EMPTY_LIST_STATS),
      })),
    })
  } catch (err) {
    console.error('[editorial/read-through/GET]', err)
    return NextResponse.json({ error: 'Failed to load reader data.' }, { status: 500 })
  }
}
