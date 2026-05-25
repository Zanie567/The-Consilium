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
export async function GET() {
  try {
    const article = await prisma.article.findFirst({
      where: {
        status:    'PUBLISHED',
        deletedAt: null,
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
      return Response.json(null, { status: 404 })
    }

    return Response.json(
      {
        title:       article.title,
        slug:        article.slug,
        excerpt:     article.excerpt,
        publishedAt: article.publishedAt.toISOString(),
        category:    article.category ?? null,
        author:      { name: article.author.name, slug: article.author.slug },
      },
      {
        headers: {
          // Cache at the CDN for 60 s, allow stale-while-revalidate for 10 s.
          // Matches the revalidate: 60 on the EconSoc consumer page.
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=10',
        },
      }
    )
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
