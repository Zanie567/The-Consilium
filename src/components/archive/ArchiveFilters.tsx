import Form from 'next/form'
import Link from 'next/link'
import { ChevronDown, Search, X } from 'lucide-react'
import { buildArchiveHref } from '@/lib/archivePagination'

interface Topic {
  id: string
  slug: string
  name: string
}

interface ArchiveFiltersProps {
  q?: string
  categorySlug?: string
  /** Selected topic slugs, already normalised. */
  tags: string[]
  categories: { id: string; slug: string; name: string }[]
  /** Topics with at least one public article. */
  topics: Topic[]
}

/** With this many topics or fewer the list is simply shown; a longer one starts folded away. */
const TOPICS_SHOWN_OPEN = 12

/**
 * Search, format and topic filters for the archive.
 *
 * A GET form whose fields are the whole query string: `page` is not a field, so a new search
 * always starts at page 1 (do not add a hidden page input; that would strand the reader on a
 * stale page number). `next/form` submits it as a client-side navigation, and it remains an
 * ordinary form when JavaScript is unavailable. It is not prefetched: the reader is already on
 * this route, and a prefetch would only run the archive's function a second time.
 */
export function ArchiveFilters({ q, categorySlug, tags, categories, topics }: ArchiveFiltersProps) {
  // A selected topic that no longer has public articles is still listed, so it can be unticked.
  const listed: Topic[] = [
    ...topics,
    ...tags.filter((slug) => !topics.some((t) => t.slug === slug)).map((slug) => ({ id: slug, slug, name: slug })),
  ]
  const topicName = (slug: string) => listed.find((t) => t.slug === slug)?.name ?? slug
  const category = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined
  const isFiltered = Boolean(q) || Boolean(categorySlug) || tags.length > 0

  // One removable chip per active filter; each link is the current view without that filter.
  const active: { key: string; label: string; href: string }[] = [
    ...(q ? [{ key: 'q', label: `“${q}”`, href: buildArchiveHref(1, undefined, categorySlug, tags) }] : []),
    ...(categorySlug
      ? [{ key: 'category', label: category?.name ?? categorySlug, href: buildArchiveHref(1, q, undefined, tags) }]
      : []),
    ...tags.map((slug) => ({
      key: `tag-${slug}`,
      label: topicName(slug),
      href: buildArchiveHref(1, q, categorySlug, tags.filter((t) => t !== slug)),
    })),
  ]

  const field =
    'h-12 border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--fg)] text-base sm:text-sm focus:outline-none'

  return (
    <Form action="/archive" prefetch={false} className="archive-filters">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
          <input
            type="search"
            name="q"
            aria-label="Search articles"
            defaultValue={q}
            placeholder="Search articles..."
            autoComplete="off"
            className={`${field} w-full pl-11 pr-4 placeholder:text-[var(--fg-faint)]`}
          />
        </div>
        <div className="relative sm:w-52">
          <select
            name="category"
            aria-label="Article format"
            defaultValue={categorySlug ?? ''}
            className={`${field} w-full cursor-pointer appearance-none pl-4 pr-10`}
          >
            <option value="">All formats</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.slug}>
                {cat.name}
              </option>
            ))}
          </select>
          <ChevronDown size={15} aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
        </div>
        <button
          type="submit"
          className="btn-press h-12 bg-navy px-7 text-xs font-bold uppercase tracking-widest text-gold transition-colors hover:bg-navy-light dark:bg-gold dark:text-navy dark:hover:bg-gold-light"
        >
          Apply filters
        </button>
      </div>

      {listed.length > 0 && (
        <details className="archive-topics mt-3 border border-[var(--border)] bg-[var(--bg-elevated)]" open={tags.length > 0 || listed.length <= TOPICS_SHOWN_OPEN}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-[var(--fg)]">
            <span>
              Topics
              {tags.length > 0 && <span className="ml-2 font-normal text-[var(--fg-muted)]">{tags.length} selected</span>}
            </span>
            <ChevronDown size={16} aria-hidden className="archive-topics-chevron text-[var(--fg-faint)]" />
          </summary>
          <fieldset className="border-t border-[var(--border)] px-4 pb-4 pt-3">
            <legend className="sr-only">Topics</legend>
            <p className="mb-3 text-xs text-[var(--fg-muted)]">
              Tick any number of topics to see articles on at least one of them, then apply.
            </p>
            <div className="flex flex-wrap gap-2">
              {listed.map((topic) => (
                <label key={topic.id} className="archive-topic-option">
                  <input type="checkbox" name="tag" value={topic.slug} defaultChecked={tags.includes(topic.slug)} />
                  {topic.name}
                </label>
              ))}
            </div>
          </fieldset>
        </details>
      )}

      {isFiltered && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--fg-muted)]">Showing</span>
          {active.map((filter) => (
            <Link
              key={filter.key}
              href={filter.href}
              prefetch={false}
              aria-label={`Remove filter ${filter.label}`}
              className="archive-active-filter"
            >
              <span className="max-w-[16rem] truncate">{filter.label}</span>
              <X size={12} aria-hidden />
            </Link>
          ))}
          <Link href="/archive" prefetch={false} className="ml-1 text-sm text-[var(--fg-muted)] underline decoration-gold/60 underline-offset-4 hover:text-[var(--fg)] hover:decoration-gold">
            Clear all filters
          </Link>
        </div>
      )}
    </Form>
  )
}
