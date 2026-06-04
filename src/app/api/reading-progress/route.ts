import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'

// GET /api/reading-progress - fetch in-progress articles for the current user
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json([], { status: 200 })

  // Propagate DB failures so the client knows something went wrong
  // rather than receiving an empty array indistinguishable from "no progress".
  try {
    const rows = await prisma.readingProgress.findMany({
      where: {
        userId: session.user.id,
        progress: { gt: 3, lt: 95 }, // only articles meaningfully started but not finished
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      include: {
        article: {
          select: {
            id: true, title: true, slug: true, coverImage: true, excerpt: true,
            author: { select: { name: true, slug: true, id: true } },
            category: { select: { name: true } },
          },
        },
      },
    })
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[reading-progress/GET]', err)
    return NextResponse.json({ error: 'Failed to fetch reading progress.' }, { status: 500 })
  }
}

// POST /api/reading-progress - upsert progress for an article
export async function POST(req: Request) {
  const user = await getVerifiedSessionUser(ALL_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { articleId, progress, scrollY } = await req.json()
  if (!articleId || typeof progress !== 'number') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Surface DB failures so the client knows progress was not saved
  // rather than receiving { ok: true } while the write silently failed.
  const completed = progress >= 90
  try {
    await prisma.readingProgress.upsert({
      where: { userId_articleId: { userId: user.id, articleId } },
      create: { userId: user.id, articleId, progress, scrollY: scrollY ?? 0, completed },
      update: { progress, scrollY: scrollY ?? 0, ...(completed ? { completed: true } : {}) },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[reading-progress/POST]', err)
    return NextResponse.json({ error: 'Failed to save reading progress.' }, { status: 500 })
  }
}
