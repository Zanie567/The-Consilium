/**
 * GET  /api/editorial/newsletter/alerts  articles published in the last 72 hours that could be an alert
 * POST /api/editorial/newsletter/alerts  { articleId }: prepare a special-article alert (draft; admins approve)
 */
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { NEWSLETTER_EDIT_ROLES } from '@/lib/rbac'
import { createAlertCampaign } from '@/lib/newsletter/campaigns'
import { ALERT_MAX_ARTICLE_AGE_MS } from '@/lib/newsletter/config'
import { campaignErrorResponse, readSmallJson, NO_STORE } from '@/lib/newsletter/http'
import { campaignSummary } from '@/lib/newsletter/overview'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireVerifiedSessionUser(NEWSLETTER_EDIT_ROLES)
  if (!auth.ok) return auth.response
  const since = new Date(Date.now() - ALERT_MAX_ARTICLE_AGE_MS)
  const articles = await prisma.article.findMany({
    where: publishedArticleWhere({ publishedAt: { gte: since } }),
    orderBy: { publishedAt: 'desc' },
    select: { id: true, title: true, publishedAt: true, author: { select: { name: true } } },
    take: 20,
  })
  const existing = await prisma.newsletterCampaign.findMany({
    where: { kind: 'ALERT', articleId: { in: articles.map((a) => a.id) } },
    select: { articleId: true },
  })
  const taken = new Set(existing.map((e) => e.articleId))
  return NextResponse.json(
    { articles: articles.map((a) => ({ id: a.id, title: a.title, author: a.author.name, publishedAt: a.publishedAt?.toISOString() ?? null, hasAlert: taken.has(a.id) })) },
    { headers: NO_STORE },
  )
}

export async function POST(request: Request) {
  const auth = await requireVerifiedSessionUser(NEWSLETTER_EDIT_ROLES)
  if (!auth.ok) return auth.response
  const body = await readSmallJson(request)
  try {
    const campaign = await createAlertCampaign(body?.articleId, { id: auth.user.id, name: auth.user.name })
    return NextResponse.json({ campaign: campaignSummary(campaign) }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return campaignErrorResponse(error)
  }
}
