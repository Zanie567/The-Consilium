import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

export async function GET() {
  const auth = await requireVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!auth.ok) return auth.response

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
