import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

async function requireAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session) return false
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true, isBanned: true },
  })
  return !!(user && user.isActive && !user.isBanned && user.role === 'ADMIN')
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const views = await prisma.articleView.findMany({
    orderBy: { viewedAt: 'desc' },
    take: 50,
    select: {
      viewedAt: true,
      referrer: true,
      article: { select: { title: true, slug: true } },
    },
  })

  return NextResponse.json(
    views.map((v) => ({
      article_title: v.article.title,
      article_slug: v.article.slug,
      viewed_at: v.viewedAt.toISOString(),
      referrer: v.referrer ?? null,
    })),
  )
}
