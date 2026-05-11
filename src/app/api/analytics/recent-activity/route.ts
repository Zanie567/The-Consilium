import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

async function requireAdmin(): Promise<boolean> {
  return !!(await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES))
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
