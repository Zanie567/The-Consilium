import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Called by GitHub Actions every 10 minutes.
// Finds all SCHEDULED articles whose scheduledAt has passed
// and flips them to PUBLISHED.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
console.log('[cron] secret defined:', !!secret)

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()

    const due = await prisma.article.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
      },
      select: {
        id: true,
        title: true,
      },
    })

    if (due.length === 0) {
      return NextResponse.json({ published: 0, articles: [] })
    }

    await prisma.article.updateMany({
      where: {
        id: { in: due.map((a) => a.id) },
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
      },
    })

    return NextResponse.json({
      published: due.length,
      articles: due.map((a) => a.title),
    })
  } catch (error) {
    console.error('[cron/publish-scheduled] Failed to publish scheduled articles:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
