'use client'
import { articleStatusLabel } from '@/lib/articleStatusLabel'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ChevronDown, ExternalLink, ImageOff, ListOrdered, Pin, Search, Trash2, TriangleAlert, X } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CoverImage } from '@/components/ui/CoverImage'
import { formatEditorialScheduleDisplay } from '@/lib/editorialSchedule'
import { apiRequest, asApiError } from '@/lib/apiClient'
import {
  ARTICLE_LIST_SORTS,
  DEFAULT_ARTICLE_LIST_FILTERS,
  filterArticlesIgnoringStatus,
  formatListDate,
  hasActiveFilters,
  isMissingCover,
  sortArticles,
  type ArticleListFilters,
  type ArticleListItem,
  type ArticleListSort,
} from '@/lib/articleListView'

type ArticleItem = ArticleListItem

interface Props {
  articles: ArticleItem[]
  isEditor: boolean
  isWriter: boolean
  emptyMessage?: React.ReactNode
  /** The page loads a bounded number of articles; true when older ones were left out. */
  truncated?: boolean
}

// Rows per page. Keeps a page of the article table close to one screen inside
// the portal's bounded scroll region.
const PAGE_SIZE = 12

/** Tags shown on a row before the rest are counted. */
const MAX_ROW_TAGS = 3

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
  PENDING_REVIEW: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  SCHEDULED: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  REJECTED: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
}

const CONTROL =
  'h-10 border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[16px] sm:text-sm text-[var(--fg)] focus:outline-none'

/**
 * The article's own cover, cropped to one landscape shape so every row lines up. An article
 * with no cover, and a cover that cannot be shown, each say so instead of leaving a gap or a
 * broken-image icon: an editor scanning the list can see which articles still need a picture.
 */
function CoverThumb({ article }: { article: ArticleItem }) {
  return (
    <div className="relative aspect-[3/2] w-[5.25rem] shrink-0 overflow-hidden bg-[var(--bg-subtle)] md:w-24">
      <CoverImage
        src={article.coverImage}
        alt=""
        sizes="96px"
        fallback={
          <div className="absolute inset-0 flex items-center justify-center border border-dashed border-[var(--border-strong)] text-[var(--fg-faint)]" title="No cover image">
            <ImageOff size={16} aria-hidden />
            <span className="sr-only">No cover image</span>
          </div>
        }
        brokenFallback={
          <div className="absolute inset-0 flex items-center justify-center border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" title="The cover image could not be loaded. Check its address in the article editor.">
            <TriangleAlert size={16} aria-hidden />
            <span className="sr-only">Cover image could not be loaded</span>
          </div>
        }
      />
    </div>
  )
}

/** When the article was (or will be) published, or else when it was last edited. */
function statusDate(article: ArticleItem): string {
  if (article.status === 'SCHEDULED' && article.scheduledAt) return formatEditorialScheduleDisplay(article.scheduledAt, { includeYear: false })
  if (article.status === 'PUBLISHED' && article.publishedAt) return `Published ${formatListDate(article.publishedAt)}`
  return `Edited ${formatListDate(article.updatedAt)}`
}

export function ArticlesList({ articles: initial, isEditor, isWriter: _isWriter, emptyMessage, truncated = false }: Props) {
  const [articles, setArticles] = useState(initial)
  const [filters, setFilters] = useState<ArticleListFilters>(DEFAULT_ARTICLE_LIST_FILTERS)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // A refresh started by an earlier action can finish after a later save.
    // Keep each newer acknowledged row rather than restore an obsolete guard.
    setArticles(current => {
      const rows = new Map(current.map(article => [article.id, article]))
      return initial.map(article => {
        const saved = rows.get(article.id)
        return saved && Date.parse(saved.updatedAt) > Date.parse(article.updatedAt) ? saved : article
      })
    })
    // The filters are left alone: a background refresh must not undo a search in progress. A
    // status that no longer exists in the list is handled where the status is read, below.
  }, [initial])

  const toggle = (id: string, field: 'isPinned', value: boolean) => {
    setArticles((prev) => prev.map((a) => a.id === id ? { ...a, [field]: value } : a))
  }

  const reloadChangedArticle = async (id: string) => {
    // A rejected mutation must replace the stale row before the next action.
    // Read it explicitly instead of depending on a background route refresh.
    try {
      const latest = await apiRequest<ArticleItem>(`/api/articles/${id}`, { cache: 'no-store' })
      setArticles(prev => prev.map(article => article.id === id ? latest : article))
    } catch (reason) {
      const error = asApiError(reason)
      if (error.status === 403 || error.status === 404) {
        setArticles(prev => prev.filter(article => article.id !== id))
      }
      setError(message => `${message ?? 'The article changed.'} The latest version could not be loaded: ${error.message}`)
    }
  }

  const pinArticle = async (article: ArticleItem) => {
    const { id, isPinned: current, updatedAt } = article
    setError(null)
    try {
      const method = current ? 'DELETE' : 'POST'
      const saved = await apiRequest<{ updatedAt: string }>(`/api/editorial/articles/${id}/pin`, { method, headers: { 'x-article-revision': updatedAt } })
      setArticles(prev => prev.map(a => a.id === id ? { ...a, updatedAt: saved.updatedAt } : a))
      toggle(id, 'isPinned', !current)
    } catch (reason) {
      setError(asApiError(reason).message)
      if (asApiError(reason).status === 409) await reloadChangedArticle(id)
    }
  }

  const deleteArticle = async (article: ArticleItem) => {
    const { id, updatedAt } = article
    if (!confirm('Move this article to trash? It can be restored for 30 days.')) return
    setError(null)
    try {
      await apiRequest(`/api/articles/${id}`, { method: 'DELETE', headers: { 'x-article-revision': updatedAt } })
      setArticles((prev) => prev.filter((article) => article.id !== id))
    } catch (reason) {
      setError(asApiError(reason).message)
      if (asApiError(reason).status === 409) await reloadChangedArticle(id)
    }
  }

  // Publishing from the list is a two-step action: the button only asks, the dialog confirms.
  const [pendingPublish, setPendingPublish] = useState<ArticleItem | null>(null)
  const [publishing, setPublishing] = useState(false)

  const publishArticle = async (article: ArticleItem) => {
    const { id, status: currentStatus, updatedAt } = article
    const newStatus = currentStatus === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
    setError(null)
    setPublishing(true)
    try {
      const saved = await apiRequest<ArticleItem>(`/api/articles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, publicationIntent: true, expectedUpdatedAt: updatedAt }),
      })
      setArticles((prev) => prev.map((article) => (
        article.id === id ? { ...article, status: saved.status, updatedAt: saved.updatedAt, publishedAt: saved.publishedAt, scheduledAt: saved.scheduledAt } : article
      )))
    } catch (reason) {
      setError(asApiError(reason).message)
      if (asApiError(reason).status === 409) await reloadChangedArticle(id)
    } finally {
      setPublishing(false)
      setPendingPublish(null)
    }
  }

  // Changing any filter returns to the first page of the new result.
  const updateFilters = (change: Partial<ArticleListFilters>) => {
    setFilters((current) => ({ ...current, ...change }))
    setPage(1)
  }

  // Derive statuses and counts from the current rows (not the initial props) so they stay
  // correct after a delete or a publish. The counts respect the search and the other filters,
  // so a tab never promises rows it will not show.
  const narrowed = useMemo(() => filterArticlesIgnoringStatus(articles, filters), [articles, filters])
  const statuses = useMemo(() => ['all', ...Array.from(new Set(articles.map((a) => a.status)))], [articles])
  // A status tab disappears with its last article; fall back to "All" rather than an empty list.
  const status = statuses.includes(filters.status) ? filters.status : 'all'
  const filtered = useMemo(
    () => sortArticles(status === 'all' ? narrowed : narrowed.filter((a) => a.status === status), filters.sort),
    [narrowed, status, filters.sort],
  )
  const categories = useMemo(() => {
    const bySlug = new Map<string, string>()
    for (const article of articles) if (article.category) bySlug.set(article.category.slug, article.category.name)
    return [...bySlug].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [articles])
  const hasUncategorised = articles.some((a) => a.category === null)
  const missingCoverCount = useMemo(() => articles.filter(isMissingCover).length, [articles])
  const filtersActive = hasActiveFilters({ ...filters, status })

  // Paginate. The page query returns a bounded set and every one of them
  // used to render at once, so the list ran several viewports deep inside the
  // portal's scroll region and grew without bound as the archive did.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Clamp rather than store a corrected page: deleting the last row of the
  // last page, or switching to a shorter filter, can leave `page` past the end.
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <div>
      <ConfirmDialog
        open={pendingPublish !== null}
        title={pendingPublish?.status === 'PUBLISHED' ? 'Unpublish this article?' : 'Publish this article?'}
        message={
          pendingPublish?.status === 'PUBLISHED'
            ? `“${pendingPublish?.title}” disappears from the public site immediately. Nothing is deleted.`
            : `“${pendingPublish?.title}” goes live on the public site immediately, visible to every reader.`
        }
        confirmLabel={pendingPublish?.status === 'PUBLISHED' ? 'Unpublish' : 'Publish now'}
        tone={pendingPublish?.status === 'PUBLISHED' ? 'danger' : 'default'}
        busy={publishing}
        onConfirm={() => { if (pendingPublish && !publishing) void publishArticle(pendingPublish) }}
        onCancel={() => { if (!publishing) setPendingPublish(null) }}
      />
      {error && (
        <div role="alert" className="mb-4 px-4 py-3 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20">
          {error}
        </div>
      )}

      {/* Search, format and sort */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row" role="search" aria-label="Find articles">
        <div className="relative flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => updateFilters({ query: event.target.value })}
            aria-label="Search articles by title, author or tag"
            placeholder={isEditor ? 'Search by title, author or tag' : 'Search by title or tag'}
            autoComplete="off"
            className={`${CONTROL} w-full pl-10 pr-9 placeholder:text-[var(--fg-faint)]`}
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => updateFilters({ query: '' })}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-[var(--fg-faint)] hover:text-[var(--fg)]"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-44 sm:flex-none">
            <select
              value={filters.category}
              onChange={(event) => updateFilters({ category: event.target.value })}
              aria-label="Filter by format"
              className={`${CONTROL} w-full cursor-pointer appearance-none pl-3 pr-8`}
            >
              <option value="all">All formats</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>{category.name}</option>
              ))}
              {hasUncategorised && <option value="none">No format</option>}
            </select>
            <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
          </div>
          <div className="relative flex-1 sm:w-52 sm:flex-none">
            <select
              value={filters.sort}
              onChange={(event) => updateFilters({ sort: event.target.value as ArticleListSort })}
              aria-label="Sort articles"
              className={`${CONTROL} w-full cursor-pointer appearance-none pl-3 pr-8`}
            >
              {ARTICLE_LIST_SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>{sort.label}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
          </div>
        </div>
      </div>

      {/* Status tabs, and the missing-cover check */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:p-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter by status">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => updateFilters({ status: s })}
            aria-pressed={status === s}
            className={`min-h-9 shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              status === s
                ? 'bg-navy text-gold'
                : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-[var(--fg)]'
            }`}
          >
            {s === 'all' ? 'All' : articleStatusLabel(s)}
            <span className="ml-1.5 opacity-60">
              {s === 'all'
                ? narrowed.length
                : narrowed.filter((a) => a.status === s).length}
            </span>
          </button>
        ))}
        </div>
        {missingCoverCount > 0 && (
          <label className="flex sm:ml-auto min-h-9 cursor-pointer items-center gap-2 pl-2 text-xs text-[var(--fg-muted)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold">
            <input
              type="checkbox"
              checked={filters.missingCover}
              onChange={(event) => updateFilters({ missingCover: event.target.checked })}
              className="h-4 w-4 cursor-pointer accent-navy dark:accent-gold"
            />
            Without a cover image
            <span className="opacity-60">{missingCoverCount}</span>
          </label>
        )}
      </div>

      <div className="@container bg-[var(--bg-elevated)] border border-[var(--border)]">
        {filtered.length > 0 ? (
          // A table when the list itself is at least 48rem wide; narrower than that (a phone, or a
          // tablet beside the portal sidebar) each row is laid out as a card: picture and
          // headline, then status, then actions. Container queries (@3xl, @5xl) rather than
          // viewport breakpoints, because the room available depends on the sidebar. The explicit
          // roles keep it a table to assistive technology, which CSS `display` would take away.
          <table role="table" className="block w-full text-sm @3xl:table">
            <thead role="rowgroup" className="hidden @3xl:table-header-group">
              <tr role="row" className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                <th role="columnheader" scope="col" className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                  Article
                </th>
                <th role="columnheader" scope="col" className="px-3 py-3 text-left text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider hidden @5xl:table-cell">
                  Format
                </th>
                <th role="columnheader" scope="col" className="px-3 py-3 text-left text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                  Status
                </th>
                <th role="columnheader" scope="col" className="px-4 py-3 text-right text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="block divide-y divide-[var(--border)] @3xl:table-row-group">
              {paged.map((article) => {
                const tags = article.tags ?? []
                const shownTags = tags.slice(0, MAX_ROW_TAGS)
                return (
                <tr role="row" key={article.id} className="group flex flex-wrap items-center gap-x-3 px-3 py-3 transition-colors hover:bg-[var(--bg-subtle)] @3xl:table-row @3xl:p-0">
                  <td role="cell" className="block w-full @3xl:table-cell @3xl:w-auto @3xl:px-4 @3xl:py-3 @3xl:align-middle">
                    <div className="flex items-start gap-3 @3xl:items-center">
                      <CoverThumb article={article} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1.5">
                          {article.isPinned && (
                            <Pin size={12} className="mt-1 shrink-0 fill-gold text-gold" aria-label="Pinned to its category page" />
                          )}
                          <Link
                            href={`/editorial/articles/${article.id}/edit`}
                            className="line-clamp-2 text-[0.95rem] font-semibold leading-snug text-[var(--fg)] decoration-gold underline-offset-4 hover:underline "
                            style={{ fontFamily: 'var(--font-serif)' }}
                          >
                            {/* Bug 7: show a styled fallback for untitled articles */}
                            {article.title || <span className="italic font-normal text-[var(--fg-faint)]">(Untitled)</span>}
                          </Link>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--fg-muted)]">
                          {isEditor && article.author.name && <span>{article.author.name}</span>}
                          <span className={`@5xl:hidden ${isEditor && article.author.name ? "before:mr-2 before:text-[var(--fg-faint)] before:content-['/']" : ''}`}>
                            {article.category?.name ?? 'Uncategorised'}
                          </span>
                          {shownTags.length > 0 && (
                            <ul className="flex flex-wrap items-center gap-1" aria-label="Tags">
                              {shownTags.map(({ tag }) => (
                                <li key={tag.slug} className="border border-[var(--border-strong)] px-1.5 py-px text-[11px] leading-4 text-[var(--fg-muted)]">
                                  {tag.name}
                                </li>
                              ))}
                              {tags.length > shownTags.length && (
                                <li className="text-[11px] text-[var(--fg-faint)]" title={tags.slice(MAX_ROW_TAGS).map((t) => t.tag.name).join(', ')}>
                                  +{tags.length - shownTags.length}
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td role="cell" className="px-3 py-3 text-[var(--fg-muted)] text-xs hidden @5xl:table-cell @3xl:align-middle">
                    {article.category?.name ?? <span className="text-[var(--fg-faint)]">Uncategorised</span>}
                  </td>
                  <td role="cell" className="mt-2.5 flex w-full items-center gap-2 @xl:w-auto @xl:flex-1 @3xl:mt-0 @3xl:table-cell @3xl:px-3 @3xl:py-3 @3xl:align-middle">
                    <span className={`inline-block whitespace-nowrap text-xs font-bold px-2 py-0.5 ${STATUS_STYLE[article.status] ?? ''}`}>
                      {articleStatusLabel(article.status)}
                    </span>
                    <p className={`whitespace-nowrap text-[11px] @3xl:mt-1 ${article.status === 'SCHEDULED' ? 'text-blue-700 dark:text-blue-400' : 'text-[var(--fg-muted)]'}`}>
                      {statusDate(article)}
                    </p>
                  </td>
                  <td role="cell" className="mt-1.5 block w-full @xl:mt-2.5 @xl:w-auto @3xl:mt-0 @3xl:table-cell @3xl:px-4 @3xl:py-3 @3xl:align-middle">
                    <div className="-mx-1.5 flex flex-wrap items-center @xl:mx-0 @xl:justify-end @3xl:flex-nowrap @3xl:gap-0.5">
                      {isEditor && article.status === 'PUBLISHED' && (
                        <>
                          <Tooltip content="Manage homepage carousel order and selection in the article editor" variant="editorial" side="top" maxWidth={280}>
                            <Link href={`/editorial/articles/${article.id}/edit`} aria-label="Manage homepage carousel in article editor"
                              className="hidden h-8 w-8 items-center justify-center text-[var(--fg-muted)] hover:text-gold @3xl:flex">
                              {/* Table layout only: on a card it would be a second "Edit". */}
                              <ListOrdered size={14} />
                            </Link>
                          </Tooltip>
                          <Tooltip
                            content={article.isPinned ? 'Unpin from category page' : 'Pin to the top of this article\'s category page'}
                            variant="editorial" side="top" maxWidth={260}
                          >
                            <button
                              onClick={() => pinArticle(article)}
                              aria-label={article.isPinned ? 'Unpin' : 'Pin to category'}
                              className={`flex h-10 w-9 items-center justify-center transition-colors @3xl:h-8 @3xl:w-8 ${
                                article.isPinned ? 'text-gold' : 'text-[var(--fg-muted)] hover:text-gold'
                              }`}
                            >
                              <Pin size={14} className={article.isPinned ? 'fill-gold' : ''} />
                            </button>
                          </Tooltip>
                        </>
                      )}
                      {article.status === 'PUBLISHED' && (
                        <Tooltip content="Open the live article on the public website" variant="editorial" side="top">
                          <a
                            href={`/articles/${article.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="View live article"
                            className="flex h-10 w-9 items-center justify-center text-[var(--fg-muted)] hover:text-gold transition-colors @3xl:h-8 @3xl:w-8"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </Tooltip>
                      )}
                      {isEditor && article.status === 'PUBLISHED' && (
                        <Tooltip content="Issue a correction, clarification or update, or see this article's correction history" variant="editorial" side="top" maxWidth={260}>
                          <Link
                            href={`/editorial/articles/${article.id}/corrections`}
                            className="flex min-h-10 items-center text-[var(--fg-muted)] text-xs font-bold hover:text-gold hover:underline px-1.5 @3xl:min-h-8"
                          >
                            Corrections
                          </Link>
                        </Tooltip>
                      )}
                      {isEditor && article.status === 'PENDING_REVIEW' && (
                        <Tooltip content="Open review panel to approve, schedule, or return this article" variant="editorial" side="top" maxWidth={260}>
                          <Link
                            href={`/editorial/review/${article.id}`}
                            className="flex min-h-10 items-center text-amber-700 dark:text-amber-400 text-xs font-bold hover:underline px-1.5 @3xl:min-h-8"
                          >
                            Review
                          </Link>
                        </Tooltip>
                      )}
                      <Tooltip content="Open in the article editor" variant="editorial" side="top">
                        <Link
                          href={`/editorial/articles/${article.id}/edit`}
                          className="flex min-h-10 items-center text-gold-dark dark:text-gold text-xs font-bold hover:underline px-1.5 @3xl:min-h-8"
                        >
                          Edit
                        </Link>
                      </Tooltip>
                      {isEditor && (article.status === 'DRAFT' || article.status === 'PUBLISHED' || article.status === 'PENDING_REVIEW') && (
                        <Tooltip
                          content={article.status === 'PUBLISHED' ? 'Unpublish this article (move back to Draft)' : 'Publish this article immediately'}
                          variant="editorial"
                          side="top"
                          maxWidth={240}
                        >
                          <button
                            onClick={() => setPendingPublish(article)}
                            className={`flex min-h-10 items-center text-xs font-bold px-1.5 transition-colors @3xl:min-h-8 ${
                              article.status === 'PUBLISHED'
                                ? 'text-[var(--fg-muted)] hover:text-amber-600'
                                : 'text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300'
                            }`}
                          >
                            {article.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                          </button>
                        </Tooltip>
                      )}
                      {/* A writer can trash only what they can still edit; the server enforces the same. */}
                      {(isEditor || article.status === 'DRAFT' || article.status === 'REJECTED') && (
                        <Tooltip content="Move this article to the trash. It can be restored for 30 days." variant="editorial" side="top" maxWidth={240}>
                          <button
                            onClick={() => deleteArticle(article)}
                            aria-label="Delete article"
                            className="ml-auto flex h-10 w-9 items-center justify-center text-[var(--fg-muted)] hover:text-red-500 transition-colors @xl:ml-0 @3xl:h-8 @3xl:w-8"
                          >
                            <Trash2 size={14} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-16 text-center text-sm text-[var(--fg-muted)]">
            {articles.length === 0 ? (
              emptyMessage ?? (
                <span>
                  No articles yet.{' '}
                  <Link href="/editorial/articles/new" className="font-semibold text-gold-dark underline-offset-4 hover:underline dark:text-gold">
                    Write the first one
                  </Link>
                </span>
              )
            ) : (
              <>
                <p>No articles match this filter.</p>
                {filtersActive && (
                  <button
                    type="button"
                    onClick={() => { setFilters({ ...DEFAULT_ARTICLE_LIST_FILTERS, sort: filters.sort }); setPage(1) }}
                    className="mt-3 text-xs font-bold uppercase tracking-wider text-gold-dark underline-offset-4 hover:underline dark:text-gold"
                  >
                    Clear search and filters
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="text-xs text-[var(--fg-muted)]" aria-live="polite">
          {filtered.length === 0
            ? 'No articles to show'
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          {truncated && ' (the most recently updated articles; older ones are not listed here)'}
        </p>
        {filtered.length > PAGE_SIZE && (
          <nav className="flex items-center gap-2" aria-label="Article list pages">
            <button
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-[var(--fg)] disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--fg-muted)] transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-[var(--fg-muted)]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="min-h-9 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-[var(--fg)] disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--fg-muted)] transition-colors"
            >
              Next
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
