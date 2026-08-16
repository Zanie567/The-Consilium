import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { escapeLikePattern, normaliseSearchText } from '@/lib/searchText'

// Extract plain text from Tiptap JSON content
function extractText(content: string): string {
  try {
    const doc = JSON.parse(content)
    const parts: string[] = []
    const walk = (node: { type: string; text?: string; content?: unknown[] }) => {
      if (node.text) parts.push(node.text)
      if (node.content) (node.content as typeof node[]).forEach(walk)
    }
    walk(doc)
    return parts.join(' ')
  } catch {
    return content
  }
}

// Score a result against the query tokens
function scoreResult(
  article: {
    title: string
    excerpt: string | null
    content: string
    author: { name: string | null }
    category: { name: string } | null
  },
  tokens: string[]
): number {
  const titleLower    = article.title.toLowerCase()
  const excerptLower  = (article.excerpt ?? '').toLowerCase()
  const contentText   = extractText(article.content).toLowerCase()
  const authorLower   = (article.author.name ?? '').toLowerCase()
  const categoryLower = (article.category?.name ?? '').toLowerCase()

  let score = 0
  for (const token of tokens) {
    if (titleLower.includes(token))    score += 10
    if (excerptLower.includes(token))  score += 5
    if (authorLower.includes(token))   score += 4
    if (categoryLower.includes(token)) score += 3
    if (contentText.includes(token))   score += 1
  }
  return score
}

// Find an excerpt snippet around the first match
function getSnippet(content: string, tokens: string[], maxLen = 200): string {
  const text = extractText(content)
  const lower = text.toLowerCase()
  let idx = -1
  for (const token of tokens) {
    idx = lower.indexOf(token)
    if (idx !== -1) break
  }
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '')
  const start = Math.max(0, idx - 80)
  const end = Math.min(text.length, idx + 120)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export async function GET(req: NextRequest) {
  const q = normaliseSearchText(req.nextUrl.searchParams.get('q') ?? undefined, 200) ?? ''
  if (q.length < 2) return NextResponse.json([])

  // Tokenise: split on whitespace, keep meaningful tokens; cap the count so this
  // public endpoint can't be forced into an unbounded OR-of-ILIKE full scan (DoS).
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 8)
  if (tokens.length === 0) return NextResponse.json([])

  // Escaped copies for the database only. `tokens` stays raw because scoring and
  // snippets match it with String.includes in JS, where a backslash added for
  // Postgres' benefit would stop the token matching its own text.
  const dbTokens = tokens.map(escapeLikePattern)

  try {
    // Broad fetch: any article matching at least one token across key fields
    const candidates = await prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        OR: dbTokens.flatMap((token) => [
          { title:   { contains: token, mode: 'insensitive' } },
          { excerpt: { contains: token, mode: 'insensitive' } },
          { content: { contains: token, mode: 'insensitive' } },
          { author:   { name:  { contains: token, mode: 'insensitive' } } },
          { category: { name:  { contains: token, mode: 'insensitive' } } },
        ]),
      },
      include: {
        author: { select: { id: true, name: true, slug: true, image: true } },
        category: true,
      },
      orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
      take: 50,
    })

    // Score and sort
    const scored = candidates
      .map((a) => ({ article: a, score: scoreResult(a, tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)

    const results = scored.map(({ article }) => ({
      id:          article.id,
      title:       article.title,
      slug:        article.slug,
      excerpt:     article.excerpt,
      snippet:     getSnippet(article.content, tokens),
      coverImage:  article.coverImage,
      publishedAt: article.publishedAt,
      author:      article.author,
      category:    article.category,
    }))

    return NextResponse.json(results)
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json([])
  }
}
