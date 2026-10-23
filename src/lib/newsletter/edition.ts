/**
 * What goes into an edition, and the fail-closed check that it is still true at send time.
 *
 * Eligibility starts from publishedArticleWhere (the site's one public-visibility rule: PUBLISHED, not
 * trashed, not an article of an unpublished or deleted debate) and adds: published within the edition
 * window, published at least PUBLICATION_SAFE_DELAY ago, a canonical link that can be built, and not
 * already in a sent weekly edition. Drafts, scheduled, archived (withdrawn), rejected and trashed articles
 * can therefore never appear.
 */
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { displayAuthorName } from '@/lib/authorUtils'
import { PUBLICATION_SAFE_DELAY_MS, WEEKLY_MAX_ARTICLES, newsletterSiteUrl } from './config'

export interface EditionItem {
  id: string
  slug: string
  title: string
  author: string
  /** The article's published (editorially approved) excerpt; never edited in the newsletter. */
  summary: string | null
  /** The article's excerpt when the snapshot was taken, to detect a later change. */
  sourceExcerpt: string | null
  imageUrl: string | null
  imageAlt: string
  url: string
  category: string | null
  publishedAt: string
}

export interface EditionExclusion {
  id: string
  title: string
  reason: string
}

export interface EditionContent {
  items: EditionItem[]
  excluded: EditionExclusion[]
}

const ARTICLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImage: true,
  publishedAt: true,
  author: { select: { name: true } },
  category: { select: { name: true } },
} satisfies Prisma.ArticleSelect

type ArticleRow = Prisma.ArticleGetPayload<{ select: typeof ARTICLE_SELECT }>

// Any slug the article route can serve: one non-empty path segment, no whitespace or URL delimiters.
const SLUG_PATTERN = /^[^\s/?#\\%]{1,200}$/

/** Canonical public link, or null when none can be built (never a guessed or relative link). */
export function canonicalArticleUrl(slug: string | null | undefined, siteUrl = newsletterSiteUrl()): string | null {
  if (!slug || !SLUG_PATTERN.test(slug)) return null
  try {
    const base = new URL(siteUrl)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return null
    return `${base.origin}/articles/${encodeURIComponent(slug)}`
  } catch {
    return null
  }
}

/** Absolute image URL for an email client, or null. Only https (http allowed for local capture runs). */
export function absoluteImageUrl(value: string | null | undefined, siteUrl = newsletterSiteUrl()): string | null {
  if (!value) return null
  const trimmed = value.trim()
  try {
    const base = new URL(siteUrl)
    const url = trimmed.startsWith('/') && !trimmed.startsWith('//') ? new URL(trimmed, base.origin) : new URL(trimmed)
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && base.protocol === 'http:') return url.href
    return null
  } catch {
    return null
  }
}

function toEditionItem(article: ArticleRow, siteUrl = newsletterSiteUrl()): EditionItem | EditionExclusion {
  const url = canonicalArticleUrl(article.slug, siteUrl)
  if (!url) return { id: article.id, title: article.title, reason: 'no canonical public link can be built for this article' }
  if (!article.publishedAt) return { id: article.id, title: article.title, reason: 'no publication date' }
  const author = displayAuthorName(article.author?.name).trim() || 'The Consilium'
  const excerpt = article.excerpt?.trim() || null
  return {
    id: article.id,
    slug: article.slug,
    title: article.title.trim(),
    author,
    summary: excerpt,
    sourceExcerpt: excerpt,
    imageUrl: absoluteImageUrl(article.coverImage, siteUrl),
    imageAlt: `Cover image for ${article.title.trim()}`,
    url,
    category: article.category?.name ?? null,
    publishedAt: article.publishedAt.toISOString(),
  }
}

function isExclusion(value: EditionItem | EditionExclusion): value is EditionExclusion {
  return 'reason' in value
}

/** Article ids that were part of any weekly edition already sent. */
async function alreadySentArticleIds(db: Pick<typeof prisma, 'newsletterCampaign'>): Promise<Set<string>> {
  const sent = await db.newsletterCampaign.findMany({ where: { kind: 'WEEKLY', status: { in: ['SENT', 'SENDING'] } }, select: { articles: true } })
  const ids = new Set<string>()
  for (const row of sent) for (const item of readContent(row.articles).items) ids.add(item.id)
  return ids
}

export async function buildWeeklyContent(window: { start: Date; end: Date }, now: Date, db: typeof prisma = prisma): Promise<EditionContent> {
  const latest = new Date(Math.min(window.end.getTime(), now.getTime() - PUBLICATION_SAFE_DELAY_MS))
  const rows = await db.article.findMany({
    where: publishedArticleWhere({ publishedAt: { gt: window.start, lte: latest } }),
    orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
    select: ARTICLE_SELECT,
    take: 100,
  })
  const sent = await alreadySentArticleIds(db)
  const content: EditionContent = { items: [], excluded: [] }
  for (const row of rows) {
    if (sent.has(row.id)) {
      content.excluded.push({ id: row.id, title: row.title, reason: 'already included in a sent weekly edition' })
      continue
    }
    const item = toEditionItem(row)
    if (isExclusion(item)) content.excluded.push(item)
    else if (content.items.length >= WEEKLY_MAX_ARTICLES) content.excluded.push({ id: row.id, title: row.title, reason: `edition limit of ${WEEKLY_MAX_ARTICLES} articles reached` })
    else content.items.push(item)
  }
  return content
}

export async function buildAlertContent(articleId: string, db: typeof prisma = prisma): Promise<EditionItem | EditionExclusion | null> {
  const row = await db.article.findFirst({ where: publishedArticleWhere({ id: articleId, publishedAt: { not: null } }), select: ARTICLE_SELECT })
  return row ? toEditionItem(row) : null
}

export function readContent(value: Prisma.JsonValue): EditionContent {
  const raw = (value ?? {}) as Partial<EditionContent>
  return { items: Array.isArray(raw.items) ? raw.items : [], excluded: Array.isArray(raw.excluded) ? raw.excluded : [] }
}

/** Canonical content hash: approval is bound to exactly this. */
export function contentHash(input: { subject: string; previewText: string | null; intro: string | null; items: EditionItem[] }): string {
  const canonical = JSON.stringify({
    subject: input.subject,
    previewText: input.previewText ?? null,
    intro: input.intro ?? null,
    items: input.items.map((i) => [i.id, i.slug, i.title, i.author, i.summary, i.imageUrl, i.url, i.publishedAt]),
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export interface PublicationProblem {
  id: string
  title: string
  problem: string
}

/**
 * Fail-closed send-time check: every article in the approved snapshot must still be public, at the same
 * link, with the same title and summary source, and published at least the safe delay ago. Optionally also
 * fetches each canonical link (production) and requires HTTP 200.
 */
export async function verifySnapshotStillPublic(
  items: EditionItem[],
  now: Date,
  options: { fetchLinks?: boolean; fetchImpl?: typeof fetch; db?: typeof prisma } = {},
): Promise<PublicationProblem[]> {
  const db = options.db ?? prisma
  const problems: PublicationProblem[] = []
  if (items.length === 0) return [{ id: '-', title: '-', problem: 'the edition has no articles' }]
  const rows = await db.article.findMany({ where: publishedArticleWhere({ id: { in: items.map((i) => i.id) } }), select: ARTICLE_SELECT })
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const item of items) {
    const row = byId.get(item.id)
    if (!row) {
      problems.push({ id: item.id, title: item.title, problem: 'no longer publicly published (unpublished, scheduled, archived, trashed or hidden)' })
      continue
    }
    if (!row.publishedAt || row.publishedAt.getTime() > now.getTime() - PUBLICATION_SAFE_DELAY_MS) {
      problems.push({ id: item.id, title: item.title, problem: 'publication time moved inside the safe delay' })
    }
    if (row.slug !== item.slug || canonicalArticleUrl(row.slug) !== item.url) problems.push({ id: item.id, title: item.title, problem: 'the article link changed' })
    if (row.title.trim() !== item.title) problems.push({ id: item.id, title: item.title, problem: 'the title changed after approval' })
    if ((row.excerpt?.trim() || null) !== item.sourceExcerpt) problems.push({ id: item.id, title: item.title, problem: 'the summary changed after approval' })
  }
  if (options.fetchLinks && problems.length === 0) {
    const fetchImpl = options.fetchImpl ?? fetch
    for (const item of items) {
      try {
        const response = await fetchImpl(item.url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'ConsiliumNewsletterLinkCheck/1.0' } })
        void response.body?.cancel()
        if (response.status !== 200) problems.push({ id: item.id, title: item.title, problem: `public link answered HTTP ${response.status}` })
      } catch (error) {
        problems.push({ id: item.id, title: item.title, problem: `public link could not be fetched (${(error as Error).name})` })
      }
    }
  }
  return problems
}
