/**
 * POST /api/award-trophies
 *
 * Checks all published articles against trophy thresholds and awards missing
 * trophies. Called hourly by a GitHub Actions workflow.
 *
 * Authentication: x-cron-secret header must match CRON_SECRET env var.
 *
 * GitHub Actions secret required: CRON_SECRET
 * Vercel env var required:        CRON_SECRET (same value)
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TROPHY_THRESHOLDS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[award-trophies] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const provided = req.headers.get('x-cron-secret') ?? ''
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const articles = await prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { id: true, title: true, viewCount: true },
    })

    const articleMap = new Map(articles.map((a) => [a.id, a]))

    const candidates: Array<{ articleId: string; trophy: string }> = []
    for (const article of articles) {
      for (const [tier, threshold] of Object.entries(TROPHY_THRESHOLDS) as [
        keyof typeof TROPHY_THRESHOLDS,
        number,
      ][]) {
        if (article.viewCount >= threshold) {
          candidates.push({ articleId: article.id, trophy: tier })
        }
      }
    }

    if (candidates.length === 0) {
      console.log('[award-trophies] No articles meet any trophy threshold')
      return NextResponse.json({ awarded: 0, checked: articles.length, articles: [] })
    }

    const existing = await prisma.articleTrophy.findMany({
      where: { articleId: { in: articles.map((a) => a.id) } },
      select: { articleId: true, trophy: true },
    })
    const existingSet = new Set(existing.map((t) => `${t.articleId}:${t.trophy}`))

    const newTrophies = candidates.filter(
      (t) => !existingSet.has(`${t.articleId}:${t.trophy}`)
    )

    if (newTrophies.length === 0) {
      console.log('[award-trophies] All eligible trophies already awarded')
      return NextResponse.json({ awarded: 0, checked: articles.length, articles: [] })
    }

    await prisma.articleTrophy.createMany({
      data: newTrophies,
      skipDuplicates: true,
    })

    const awardedArticles = newTrophies.map((t) => ({
      articleId: t.articleId,
      title: articleMap.get(t.articleId)?.title ?? 'Unknown',
      trophy: t.trophy,
    }))

    console.log(`[award-trophies] Awarded ${newTrophies.length} trophies:`, awardedArticles)

    return NextResponse.json({
      awarded: newTrophies.length,
      checked: articles.length,
      articles: awardedArticles,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[award-trophies] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
