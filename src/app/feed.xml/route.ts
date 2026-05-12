import { prisma } from '@/lib/prisma'

const SITE_URL = 'https://the-consilium.vercel.app'
const CHANNEL_DESCRIPTION =
  'Economics analysis, opinion, and research from the University of Edinburgh'

export const dynamic = 'force-dynamic'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
}

export async function GET(): Promise<Response> {
  try {
    const articles = await prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      include: { author: true, category: true },
    })

    const items = articles
      .map((article) => {
        const publishedAt = article.publishedAt

        if (publishedAt === null) {
          return ''
        }

        const link = `${SITE_URL}/articles/${article.slug}`
        const category = article.category?.name

        return `<item>
  <title>${cdata(article.title)}</title>
  <link>${escapeXml(link)}</link>
  <guid isPermaLink="true">${escapeXml(link)}</guid>
  <description>${cdata(article.excerpt ?? '')}</description>
  <pubDate>${publishedAt.toUTCString()}</pubDate>
  <author>${escapeXml(article.author.name ?? 'The Consilium')}</author>
  ${category ? `<category>${escapeXml(category)}</category>` : ''}
</item>`
      })
      .join('\n')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>The Consilium</title>
  <link>${SITE_URL}</link>
  <description>${CHANNEL_DESCRIPTION}</description>
  <language>en-gb</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (error) {
    console.error('Failed to generate RSS feed', error)

    return new Response('Failed to generate RSS feed', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
