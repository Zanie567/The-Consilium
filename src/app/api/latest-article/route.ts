import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Public, unauthenticated endpoint. Consumed by the EconSoc website to display
// the latest published article in its ConsiliumFeature section.
// Cache-Control lets Vercel's CDN serve this for 1 hour without hitting the DB.
export const dynamic = 'force-dynamic'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
}

export async function GET() {
  try {
    const article = await prisma.article.findFirst({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
      },
      orderBy: { publishedAt: 'desc' },
      select: {
        title:       true,
        slug:        true,
        excerpt:     true,
        publishedAt: true,
        category: {
          select: { name: true, slug: true },
        },
        author: {
          select: { name: true, slug: true },
        },
      },
    })

    if (!article) {
      return NextResponse.json(
        { error: 'No published articles found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    return NextResponse.json(article, { headers: CORS_HEADERS })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }
}
