import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

function hashSession(sessionId: string, key: string, timeBucket: number): string {
  return createHash('sha256').update(`${sessionId}:${key}:${timeBucket}`).digest('hex')
}

export async function POST(req: NextRequest) {
  // 60 track events per IP per minute — bots/scrapers get silently dropped
  if (!checkRateLimit(`track:${getIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ ok: true })
  }

  try {
    const body = await req.json()
    const { articleId, sessionId, referrer, pagePath } = body

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ ok: true }) // silent drop
    }

    // 30-minute deduplication bucket
    const timeBucket = Math.floor(Date.now() / 1_800_000)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

    const sanitisedReferrer = typeof referrer === 'string' ? referrer.slice(0, 500) : null

    if (articleId && typeof articleId === 'string') {
      const sessionHash = hashSession(sessionId, articleId, timeBucket)

      // Deduplicate: same session+article within 30 min = one view
      const existing = await prisma.articleView.findFirst({
        where: { sessionHash, viewedAt: { gte: thirtyMinutesAgo } },
        select: { id: true },
      })

      if (!existing) {
        await prisma.$transaction([
          prisma.articleView.create({
            data: { articleId, sessionHash, referrer: sanitisedReferrer },
          }),
          prisma.article.update({
            where: { id: articleId },
            data: { viewCount: { increment: 1 } },
          }),
        ])
      }
    } else {
      // Site-level view (homepage etc.)
      const path = typeof pagePath === 'string' ? pagePath.slice(0, 500) : '/'
      const sessionHash = hashSession(sessionId, path, timeBucket)

      const existing = await prisma.siteView.findFirst({
        where: { sessionHash, viewedAt: { gte: thirtyMinutesAgo } },
        select: { id: true },
      })

      if (!existing) {
        await prisma.siteView.create({
          data: { sessionHash, referrer: sanitisedReferrer, pagePath: path },
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true }) // never block the reader
  }
}
