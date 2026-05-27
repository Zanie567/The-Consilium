import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()

    const articles = await prisma.article.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: {
          lte: now,
        },
      },
      select: {
        id: true,
        title: true,
      },
    })

    if (articles.length === 0) {
      return NextResponse.json({ published: 0, articles: [] }, { status: 200 })
    }

    const articleIds = articles.map((article) => article.id)

    const result = await prisma.article.updateMany({
      where: {
        id: {
          in: articleIds,
        },
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
      },
    })

    return NextResponse.json(
      {
        published: result.count,
        articles: articles.map((article) => article.title),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[publish-scheduled-cron] Failed to publish scheduled articles:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
