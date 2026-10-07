import { NextResponse, NextRequest } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { ALL_ROLES } from '@/lib/rbac'

// GET /api/bookmarks - returns all bookmarked article IDs for the current user
export async function GET() {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response

  try {
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: auth.user.id },
      select: { articleId: true },
    })
    return NextResponse.json(bookmarks.map((b) => b.articleId))
  } catch {
    return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 })
  }
}

// POST /api/bookmarks - toggle a bookmark (add if missing, remove if present)
export async function POST(request: NextRequest) {
  const auth = await requireVerifiedSessionUser(ALL_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  try {
    const { articleId } = await request.json()
    if (typeof articleId !== 'string' || !articleId) {
      return NextResponse.json({ error: 'articleId required' }, { status: 400 })
    }

    const existing = await prisma.bookmark.findUnique({
      where: { userId_articleId: { userId: user.id, articleId } },
    })

    if (existing) {
      await prisma.bookmark.delete({
        where: { userId_articleId: { userId: user.id, articleId } },
      })
      return NextResponse.json({ bookmarked: false })
    } else {
      const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true } })
      if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })
      await prisma.bookmark.create({
        data: { userId: user.id, articleId },
      })
      return NextResponse.json({ bookmarked: true })
    }
  } catch (error) {
    // A deletion between validation and insert has the same controlled contract.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to toggle bookmark' }, { status: 500 })
  }
}
