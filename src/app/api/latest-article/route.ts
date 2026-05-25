import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/latest-article
 *
 * Public, unauthenticated endpoint consumed by the EconSoc website to display
 * the most recently published article in the ConsiliumFeature section.
 *
 * Returns only fields that are already publicly visible on the site — no auth
 * required. The select is intentionally narrow: do not expand it with private
 * fields (email, password, role, etc.).
 */

// Prevent static rendering — this route queries the DB at request time.
export const dynamic = 'force-dynamic'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  // Cache at CDN for 60 s (matches EconSoc ISR revalidate: 60).
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=10',
}

export async function GET() {
  try {
    const article = await prisma.article.findFirst({
      where: {
        status:      'PUBLISHED',
        deletedAt:   null,
        publishedAt: { not: null },
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

    if (!article || !article.publishedAt) {
      return NextResponse.json(null, { status: 404, headers: CORS_HEADERS })
    }

    return NextResponse.json(
      {
        title:       article.title,
        slug:        article.slug,
        excerpt:     article.excerpt,
        publishedAt: article.publishedAt.toISOString(),
        category:    article.category ?? null,
        author:      { name: article.author.name, slug: article.author.slug },
      },
      { headers: CORS_HEADERS }
    )
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }
}
