import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normaliseSearchText, escapeLikePattern } from '@/lib/searchText'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { DISCOVERY_ARTICLE_SELECT } from '@/lib/discoveryQueries'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const full = req.nextUrl.searchParams.get('scope') === 'all'
  const q = normaliseSearchText(req.nextUrl.searchParams.get('q') ?? undefined, 200) ?? ''
  const page = Math.min(500, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1))
  const empty = { articles: [], authors: [], topics: [], page, hasMore: false }
  if (q.length < 2) return NextResponse.json(full ? empty : [])
  if (!checkRateLimit(`search:${getIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Please wait a moment before searching again.' }, { status: 429 })
  }
  const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2).slice(0, 8).map(escapeLikePattern)
  if (!tokens.length) return NextResponse.json(full ? empty : [])
  try {
    const where = publishedArticleWhere({ OR: tokens.flatMap(token => [
      { title: { contains: token, mode: 'insensitive' as const } },
      { excerpt: { contains: token, mode: 'insensitive' as const } },
      { author: { name: { contains: token, mode: 'insensitive' as const } } },
      { category: { name: { contains: token, mode: 'insensitive' as const } } },
      { tags: { some: { tag: { name: { contains: token, mode: 'insensitive' as const } } } } },
    ]) })
    const term = escapeLikePattern(q)
    const [rows, authors, topics] = await Promise.all([
      prisma.article.findMany({ where, select: DISCOVERY_ARTICLE_SELECT,
        orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        skip: (page - 1) * 15, take: 16 }),
      full ? prisma.user.findMany({ where: { name: { contains: term, mode: 'insensitive' }, articles: { some: publishedArticleWhere() } },
        select: { id: true, name: true, slug: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 8 }) : [],
      full ? prisma.tag.findMany({ where: { name: { contains: term, mode: 'insensitive' }, articles: { some: { article: publishedArticleWhere() } } },
        select: { id: true, name: true, slug: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 8 }) : [],
    ])
    const articles = rows.slice(0, 15).map(a => ({ ...a, snippet: (a.excerpt ?? '').slice(0, 200) }))
    return NextResponse.json(full ? { articles, authors, topics, page, hasMore: rows.length > 15 } : articles,
      { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('Search failed', err)
    return NextResponse.json({ error: 'Search is temporarily unavailable. Please try again.' }, { status: 503 })
  }
}
