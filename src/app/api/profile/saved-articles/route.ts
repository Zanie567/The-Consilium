import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'
import { apiServerErrorResponse } from '@/lib/apiResponse'

// GET /api/profile/saved-articles - full bookmark list with article data
export async function GET() {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response

  try {
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        article: {
          select: {
            id: true,
            title: true,
            slug: true,
            excerpt: true,
            coverImage: true,
            publishedAt: true,
            content: true,
            author: { select: { name: true } },
            category: { select: { name: true } },
          },
        },
      },
    })
    return NextResponse.json(bookmarks)
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'profile/saved-articles:load',
      userMessage: 'Your saved articles could not be loaded because of a server error.',
      code: 'SAVED_ARTICLES_LOAD_FAILED',
    })
  }
}

// DELETE /api/profile/saved-articles?articleId=xxx - remove a bookmark
export async function DELETE(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  const { searchParams } = new URL(request.url)
  const articleId = searchParams.get('articleId')
  if (!articleId) return NextResponse.json({ error: 'articleId required' }, { status: 400 })

  try {
    await prisma.bookmark.deleteMany({
      where: { userId: user.id, articleId },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'profile/saved-articles:remove',
      userMessage: 'The bookmark could not be removed because of a server error.',
      code: 'BOOKMARK_REMOVE_FAILED',
    })
  }
}
