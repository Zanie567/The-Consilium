/**
 * View-model for the administrative debate list: one serialisable row per debate, the
 * "are the two articles consistent with the debate?" check, and the search/filter used
 * by the screen. Pure, so the rules are unit-tested without a database or a browser.
 */
import { format } from 'date-fns'
import { debateVisibility, type DebateVisibility } from '@/lib/debateVisibility'

export interface DebateArticleFacts {
  id: string
  title: string
  slug: string
  status: string
  deletedAt: Date | null
  publishedAt: Date | null
  authorName: string | null
}

export interface DebateRecord {
  id: string
  title: string
  description: string | null
  isActive: boolean
  closesAt: Date | null
  createdAt: Date
  updatedAt: Date
  unpublishedAt: Date | null
  deletedAt: Date | null
  deletedById: string | null
  forArticle: DebateArticleFacts
  againstArticle: DebateArticleFacts
}

export interface DebateAdminRow {
  id: string
  title: string
  description: string | null
  featured: boolean
  closed: boolean
  visibility: DebateVisibility
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  closesAt: string | null
  unpublishedAt: string | null
  deletedAt: string | null
  articles: {
    side: 'FOR' | 'AGAINST'
    id: string
    title: string
    slug: string
    status: string
    trashed: boolean
    /** When the article was moved to the Trash, or null while it is not there. */
    trashedAt: string | null
    author: string | null
  }[]
  votes: { for: number; against: number; total: number }
  /** A hidden debate with a still-public article, or a public debate with a missing side. */
  outOfSync: string | null
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)

function syncProblem(visibility: DebateVisibility, articles: DebateArticleFacts[]): string | null {
  const isPublic = (a: DebateArticleFacts) => a.status === 'PUBLISHED' && !a.deletedAt
  if (visibility !== 'published') {
    return articles.some(isPublic)
      ? 'An article of this hidden debate is still publicly visible. Use Unpublish again to hide it.'
      : null
  }
  return articles.every(isPublic)
    ? null
    : 'One or both articles of this published debate are not public (an editor archived, trashed or changed them separately). Republish them from the article editor if that is intended.'
}

export function buildDebateRow(
  debate: DebateRecord,
  votes: { for: number; against: number },
  now: Date = new Date(),
): DebateAdminRow {
  const visibility = debateVisibility(debate)
  const articles = [debate.forArticle, debate.againstArticle]
  const publishedAt = [debate.forArticle.publishedAt, debate.againstArticle.publishedAt]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
  return {
    id: debate.id,
    title: debate.title,
    description: debate.description,
    featured: debate.isActive && visibility === 'published',
    closed: debate.closesAt ? debate.closesAt <= now : false,
    visibility,
    createdAt: debate.createdAt.toISOString(),
    updatedAt: debate.updatedAt.toISOString(),
    publishedAt: iso(publishedAt),
    closesAt: iso(debate.closesAt),
    unpublishedAt: iso(debate.unpublishedAt),
    deletedAt: iso(debate.deletedAt),
    articles: (['FOR', 'AGAINST'] as const).map((side, i) => ({
      side,
      id: articles[i].id,
      title: articles[i].title,
      slug: articles[i].slug,
      status: articles[i].status,
      trashed: articles[i].deletedAt !== null,
      trashedAt: iso(articles[i].deletedAt),
      author: articles[i].authorName,
    })),
    votes: { for: votes.for, against: votes.against, total: votes.for + votes.against },
    outOfSync: syncProblem(visibility, articles),
  }
}

export type DebateStatusFilter = 'all' | DebateVisibility

export function filterDebateRows(
  rows: DebateAdminRow[],
  { query, status }: { query: string; status: DebateStatusFilter },
): DebateAdminRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (status !== 'all' && row.visibility !== status) return false
    if (!needle) return true
    const haystack = [
      row.title,
      row.description ?? '',
      ...row.articles.flatMap((a) => [a.title, a.author ?? '', a.slug]),
    ].join('\n').toLowerCase()
    return haystack.includes(needle)
  })
}

/** Deleted last, then newest first, so the working set is always at the top. */
export function sortDebateRows(rows: DebateAdminRow[]): DebateAdminRow[] {
  const rank: Record<DebateVisibility, number> = { published: 0, unpublished: 1, deleted: 2 }
  return [...rows].sort(
    (a, b) => rank[a.visibility] - rank[b.visibility] || b.createdAt.localeCompare(a.createdAt),
  )
}

/**
 * The minimum the article Trash promises editors. TRASH_RETENTION_DAYS (src/lib/trashPurge.ts) can only LENGTHEN
 * it, and the browser does not know the configured value, so the wording below states only what holds for any
 * retention of 30 days or more.
 */
const MIN_TRASH_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The confirmation shown before a debate is permanently deleted. It must say what is lost (the debate and every
 * vote) and what happens to the two articles: they are not deleted now and keep their ORIGINAL trash date. It never
 * names a deletion date or says an article "will" be deleted at a given clean-up, because the configured retention
 * may be longer than 30 days and another debate may still reference the same article (the purge keeps any article
 * a debate references). It gives the guaranteed restore window instead, and a plain warning once that has passed.
 */
export function debatePurgeMessage(row: Pick<DebateAdminRow, 'title' | 'votes' | 'articles'>, now: Date = new Date()): string {
  const { total, for: forVotes, against } = row.votes
  const votes = total === 0
    ? 'its vote record (no votes have been cast)'
    : `all ${total.toLocaleString('en-GB')} vote${total === 1 ? '' : 's'} on it (${forVotes.toLocaleString('en-GB')} for, ${against.toLocaleString('en-GB')} against)`
  const articles = row.articles.map((a) => {
    if (!a.trashedAt) {
      return `"${a.title}" moves to the article Trash now and can be restored for at least ${MIN_TRASH_DAYS} days.`
    }
    const since = new Date(a.trashedAt)
    const guaranteedUntil = new Date(since.getTime() + MIN_TRASH_DAYS * DAY_MS)
    return now.getTime() >= guaranteedUntil.getTime()
      ? `"${a.title}" has been in the Trash since ${format(since, 'd MMM yyyy')}, longer than the ${MIN_TRASH_DAYS}-day minimum, so it is no longer guaranteed to be restorable: restore it first if you want to keep it.`
      : `"${a.title}" has been in the Trash since ${format(since, 'd MMM yyyy')} and can be restored until at least ${format(guaranteedUntil, 'd MMM yyyy, HH:mm')}.`
  })
  return [
    `This permanently deletes "${row.title}" and ${votes}. The votes cannot be recovered.`,
    `Its articles are not deleted now and their Trash dates are not reset. Once no debate refers to an article, a daily clean-up permanently deletes it after its Trash retention period, which is at least ${MIN_TRASH_DAYS} days from the date it was trashed.`,
    ...articles,
  ].join(' ')
}
