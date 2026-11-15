/**
 * Search, filtering and sorting for the editorial article list (/editorial/articles).
 *
 * The list is filtered in the browser: the page hands over every article the signed-in user may
 * manage (already narrowed by role and category scope on the server), and narrowing that set
 * further costs no request. Pure functions, so the rules are unit-tested without rendering.
 */
import { hasDisplayableCover } from '@/lib/coverImageSource'

export interface ArticleListItem {
  id: string
  title: string | null
  status: string
  isFeatured: boolean
  isPinned: boolean
  updatedAt: string
  publishedAt: string | null
  scheduledAt: string | null
  slug: string
  coverImage?: string | null
  author: { id: string; name: string | null }
  category: { name: string; slug: string } | null
  /** The shape the article API returns, so a row can be replaced by a fresh API read. */
  tags?: { tag: { name: string; slug: string } }[]
}

export const ARTICLE_LIST_SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'published', label: 'Newest published' },
  { value: 'oldest', label: 'Least recently updated' },
  { value: 'title', label: 'Title A to Z' },
] as const

export type ArticleListSort = (typeof ARTICLE_LIST_SORTS)[number]['value']

export interface ArticleListFilters {
  /** Free text: every word must appear in the title, author, format or a tag. */
  query: string
  /** A status value, or 'all'. */
  status: string
  /** A category slug, 'none' for articles without a format, or 'all'. */
  category: string
  /** Only articles that have no usable cover image. */
  missingCover: boolean
  sort: ArticleListSort
}

export const DEFAULT_ARTICLE_LIST_FILTERS: ArticleListFilters = {
  query: '',
  status: 'all',
  category: 'all',
  missingCover: false,
  sort: 'updated',
}

/** Lower-cased, accents removed: "Économie" is found by "economie". */
export function foldSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
}

function searchableText(article: ArticleListItem): string {
  return foldSearchText(
    [article.title ?? '', article.author.name ?? '', article.category?.name ?? '', ...(article.tags ?? []).map((t) => t.tag.name)].join(' \n '),
  )
}

export function matchesQuery(article: ArticleListItem, query: string): boolean {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = searchableText(article)
  return words.every((word) => haystack.includes(word))
}

export function isMissingCover(article: ArticleListItem): boolean {
  return !hasDisplayableCover(article.coverImage)
}

/** Everything except the status filter, so the status tabs can show how many each would give. */
export function filterArticlesIgnoringStatus<T extends ArticleListItem>(articles: readonly T[], filters: ArticleListFilters): T[] {
  return articles.filter((article) => {
    if (filters.category === 'none' ? article.category !== null : filters.category !== 'all' && article.category?.slug !== filters.category) return false
    if (filters.missingCover && !isMissingCover(article)) return false
    return matchesQuery(article, filters.query)
  })
}

const time = (value: string | null): number => (value ? Date.parse(value) || 0 : 0)
const titleCollator = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true })

/** A new, sorted array. Ties fall back to the most recently updated, then the id, so the order is stable. */
export function sortArticles<T extends ArticleListItem>(articles: readonly T[], sort: ArticleListSort): T[] {
  const byUpdated = (a: T, b: T) => time(b.updatedAt) - time(a.updatedAt) || a.id.localeCompare(b.id)
  const sorted = [...articles]
  switch (sort) {
    case 'published':
      // Articles that have never been published go last, most recently updated first.
      return sorted.sort((a, b) => {
        if (!a.publishedAt || !b.publishedAt) return a.publishedAt ? -1 : b.publishedAt ? 1 : byUpdated(a, b)
        return time(b.publishedAt) - time(a.publishedAt) || byUpdated(a, b)
      })
    case 'oldest':
      return sorted.sort((a, b) => time(a.updatedAt) - time(b.updatedAt) || a.id.localeCompare(b.id))
    case 'title':
      // Untitled drafts go last rather than first.
      return sorted.sort((a, b) => {
        const [x, y] = [a.title?.trim() ?? '', b.title?.trim() ?? '']
        if (!x || !y) return x ? -1 : y ? 1 : byUpdated(a, b)
        return titleCollator.compare(x, y) || byUpdated(a, b)
      })
    default:
      return sorted.sort(byUpdated)
  }
}

export function filterAndSortArticles<T extends ArticleListItem>(articles: readonly T[], filters: ArticleListFilters): T[] {
  const narrowed = filterArticlesIgnoringStatus(articles, filters)
  return sortArticles(filters.status === 'all' ? narrowed : narrowed.filter((a) => a.status === filters.status), filters.sort)
}

export function hasActiveFilters(filters: ArticleListFilters): boolean {
  return Boolean(filters.query.trim()) || filters.status !== 'all' || filters.category !== 'all' || filters.missingCover
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const londonParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric' })

/**
 * "12 Nov 2026" in UK editorial time. Assembled from numeric parts because the month names Intl
 * produces differ between Node and browsers ("Sept" vs "Sep"), which would make the server HTML
 * and the hydrated list disagree.
 */
export function formatListDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(londonParts.formatToParts(date).map((p) => [p.type, p.value]))
  const month = MONTHS[Number(parts.month) - 1]
  return month ? `${Number(parts.day)} ${month} ${parts.year}` : ''
}
