import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/reading-progress — fetch in-progress articles for the current user
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json([], { status: 200 })

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
  }).catch(() => [])

  return NextResponse.json(rows)
}

// POST /api/reading-progress — upsert progress for an article
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  const { articleId, progress, scrollY } = await req.json()
  if (!articleId || typeof progress !== 'number') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const completed = progress >= 90
  await prisma.readingProgress.upsert({
    where: { userId_articleId: { userId: session.user.id, articleId } },
    create: { userId: session.user.id, articleId, progress, scrollY: scrollY ?? 0, completed },
    update: { progress, scrollY: scrollY ?? 0, ...(completed ? { completed: true } : {}) },
  }).catch(() => null)

  return NextResponse.json({ ok: true })
}
