import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/profile/saved-articles — full bookmark list with article data
export async function GET() {
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError

  try {
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: session!.user.id },
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
  } catch {
    return NextResponse.json({ error: 'Failed to fetch saved articles' }, { status: 500 })
  }
}

// DELETE /api/profile/saved-articles?articleId=xxx — remove a bookmark
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const authError2 = requireActiveSession(session)
  if (authError2) return authError2

  const { searchParams } = new URL(request.url)
  const articleId = searchParams.get('articleId')
  if (!articleId) return NextResponse.json({ error: 'articleId required' }, { status: 400 })

  try {
    await prisma.bookmark.deleteMany({
      where: { userId: session!.user.id, articleId },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to remove bookmark' }, { status: 500 })
  }
}
