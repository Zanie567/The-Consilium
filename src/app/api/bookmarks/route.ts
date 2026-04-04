import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/bookmarks — returns all bookmarked article IDs for the current user
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: session.user.id },
      select: { articleId: true },
    })
    return Response.json(bookmarks.map((b) => b.articleId))
  } catch {
    return Response.json({ error: 'Failed to fetch bookmarks' }, { status: 500 })
  }
}

// POST /api/bookmarks — toggle a bookmark (add if missing, remove if present)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { articleId } = await request.json()
    if (!articleId) {
      return Response.json({ error: 'articleId required' }, { status: 400 })
    }

    const existing = await prisma.bookmark.findUnique({
      where: { userId_articleId: { userId: session.user.id, articleId } },
    })

    if (existing) {
      await prisma.bookmark.delete({
        where: { userId_articleId: { userId: session.user.id, articleId } },
      })
      return Response.json({ bookmarked: false })
    } else {
      await prisma.bookmark.create({
        data: { userId: session.user.id, articleId },
      })
      return Response.json({ bookmarked: true })
    }
  } catch {
    return Response.json({ error: 'Failed to toggle bookmark' }, { status: 500 })
  }
}
