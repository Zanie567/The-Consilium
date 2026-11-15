import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { ARTICLES_CACHE_TAG, ARTICLES_REVALIDATE_SECONDS } from '@/lib/articleQueries'
import { findPublicTopics } from '@/lib/publicArticleReads'
import { unstable_cache } from 'next/cache'
import { discoveryWhere, DISCOVERY_ARTICLE_SELECT } from '@/lib/discoveryQueries'
import type { Metadata } from 'next'
import { ArticleEmptyState } from '@/components/ui/ArticleEmptyState'
import { getSectionEmptyState, noResultsEmptyState, siteEmptyState } from '@/lib/sectionEmptyStates'
import {
  ARCHIVE_PAGE_SIZE,
  buildArchiveHref,
  clampPage,
  normaliseCategorySlug,
  normaliseTagSlugs,
  normaliseSearchTerm,
  pageOffset,
  parsePageParam,
  totalPageCount,
  type SearchParamValue,
} from '@/lib/archivePagination'
import { canonicalAlternates } from '@/lib/seo'
import { groupByMonth } from '@/lib/archiveGroups'
import { hasDisplayableCover } from '@/lib/coverImageSource'
import { ArchiveFilters } from '@/components/archive/ArchiveFilters'
import { ArchiveLead, ArchiveRow } from '@/components/archive/ArchiveArticle'
import './archive.css'

/** Below this many results the first page is too short to give one article a feature slot. */
const LEAD_MIN_ARTICLES = 4

interface Props {
  // Each value is `string | string[] | undefined`, because Next resolves a
  // repeated query parameter (`?q=a&q=b`) to an array. Declaring these as plain
  // strings is what previously let an array reach Prisma, where it threw and
  // turned a crafted URL into a 500.
  searchParams: Promise<{
    q?: SearchParamValue
    category?: SearchParamValue
    page?: SearchParamValue
    tag?: SearchParamValue
  }>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams
  const q = normaliseSearchTerm(params.q)
  const categorySlug = normaliseCategorySlug(params.category)
  const page = parsePageParam(params.page)
  const tags = normaliseTagSlugs(params.tag)

  return {
    title: page > 1 ? `Archive — Page ${page}` : 'Archive',
    description: 'Browse all published articles from The Consilium.',
    alternates: canonicalAlternates(buildArchiveHref(page, q, categorySlug, tags)),
    // Search and category permutations are unbounded crawl space, and page 2+
    // is a thin slice of the same listing. Keep them followable but unindexed.
    robots:
      q || categorySlug || tags.length > 0 || page > 1
        ? { index: false, follow: true }
        : { index: true, follow: true },
  }
}

// Both queries return null rather than a fallback value when the database is
// unreachable. Returning 0/[] would render "0 articles published" over an empty
// archive and read as "we have published nothing", which is why the count's
// original catch was removed; letting the error escape instead produced a 500,
// breaking the degrade-to-HTTP-200 contract documented in src/lib/prisma.ts.
// A null lets the page say plainly that it could not load.
async function getArticleCount(q?: string, categorySlug?: string, tags: string[] = []): Promise<number | null> {
  try {
    return await prisma.article.count({ where: discoveryWhere(q, categorySlug, tags) })
  } catch {
    return null
  }
}

async function getArticles(q: string | undefined, categorySlug: string | undefined, page: number, tags: string[]) {
  try {
    return await prisma.article.findMany({
      where: discoveryWhere(q, categorySlug, tags),
      // `id` is the tiebreaker that keeps paging stable when several articles
      // share a publish timestamp. `nulls: 'last'` keeps a published-but-undated
      // article from pinning itself to the top of page 1, since Postgres sorts
      // NULLs first on DESC.
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      // Only the names are rendered. `author: true` pulled every user column —
      // email, ban reason, admin notes, lockout state — into the render for
      // each of the 20 rows; none of it reached the HTML, but none of it needs
      // to be fetched either.
      select: DISCOVERY_ARTICLE_SELECT,
      skip: pageOffset(page),
      take: ARCHIVE_PAGE_SIZE,
    })
  } catch {
    return null
  }
}

async function getCategories() {
  try {
    return await prisma.category.findMany({ orderBy: { name: 'asc' } })
  } catch {
    return []
  }
}

const getTopics = unstable_cache(() => findPublicTopics(prisma), ['discovery-topics'], { tags: [ARTICLES_CACHE_TAG], revalidate: ARTICLES_REVALIDATE_SECONDS })

export default async function ArchivePage({ searchParams }: Props) {
  const params = await searchParams
  const q = normaliseSearchTerm(params.q)
  const categorySlug = normaliseCategorySlug(params.category)
  const tags = normaliseTagSlugs(params.tag)
  const requestedPage = parsePageParam(params.page)

  const [total, categories, topics] = await Promise.all([getArticleCount(q, categorySlug, tags), getCategories(), getTopics().catch(() => [])])

  const totalPages = totalPageCount(total ?? 0)
  const page = clampPage(requestedPage, totalPages)
  const articles = total === null ? null : await getArticles(q, categorySlug, page, tags)
  const loadFailed = total === null || articles === null

  // An archive emptied by a search or a category filter is NOT "more coming soon"
  // — the reader narrowed it themselves, so offer a way to widen it again. Only a
  // genuinely empty archive promises more is on the way.
  const isFiltered = Boolean(q) || Boolean(categorySlug) || tags.length > 0
  const filteredCategory = categorySlug
    ? categories.find((c) => c.slug === categorySlug)
    : undefined
  const emptyState = q || tags.length > 0
    ? noResultsEmptyState
    : categorySlug
      ? getSectionEmptyState(categorySlug, filteredCategory?.name ?? 'This Section')
      : siteEmptyState

  // The newest article leads the first page of the unfiltered archive, when it has a picture to
  // lead with. A filtered or later page is a list to scan, so every result there gets the same
  // weight.
  const newest = !loadFailed && !isFiltered && page === 1 && articles.length >= LEAD_MIN_ARTICLES ? articles[0] : null
  const lead = newest && hasDisplayableCover(newest.coverImage) ? newest : null
  const months = loadFailed ? [] : groupByMonth(lead ? articles.slice(1) : articles)
  const firstShown = (page - 1) * ARCHIVE_PAGE_SIZE + 1
  const lastShown = firstShown + (articles?.length ?? 0) - 1

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="border-b-2 border-gold bg-navy">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          {/* No entrance animation: loading.tsx shows this same header first, and animating it
              again when the list arrives would make it blink. */}
          <h1 className="text-5xl font-bold text-gold sm:text-6xl" style={{ fontFamily: 'var(--font-serif)' }}>
            Archive
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-cream/75 sm:text-lg">
            Every article The Consilium has published, newest first. Search by headline, author or topic, or narrow
            the list by format.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        {/* Keyed on the filters in the URL: following "Clear all filters" or removing one filter
            is a client-side navigation, and the form's fields are uncontrolled, so without a
            fresh mount they would keep showing the search and ticks that were just cleared. */}
        <ArchiveFilters
          key={buildArchiveHref(1, q, categorySlug, tags)}
          q={q}
          categorySlug={categorySlug}
          tags={tags}
          categories={categories}
          topics={topics}
        />

        {loadFailed ? (
          /* Surface the failure instead of silently rendering "0 articles" */
          <div role="alert" className="mt-8 border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-600 dark:text-red-400">
            We couldn&apos;t load the archive. Please refresh the page to try again.
          </div>
        ) : (
          <>
            <p className="mt-8 border-b border-[var(--border-strong)] pb-3 text-sm text-[var(--fg-muted)]" aria-live="polite">
              <span className="font-semibold text-[var(--fg)]">
                {total} article{total !== 1 ? 's' : ''}
              </span>{' '}
              {q ? `matching "${q}"` : 'published'}
              {totalPages > 1 && articles.length > 0 && (
                <span className="text-[var(--fg-faint)]">
                  {' '}
                  · showing {firstShown}&ndash;{lastShown}
                </span>
              )}
            </p>

            {articles.length > 0 ? (
              <div className="pt-8">
                {lead && <ArchiveLead article={lead} />}
                {months.map((group, index) => (
                  <section
                    key={`${group.key}-${index}`}
                    aria-labelledby={`archive-${group.key}-${index}`}
                    className={`lg:grid lg:grid-cols-[8.5rem_minmax(0,1fr)] lg:gap-10 ${index > 0 || lead ? 'mt-10 lg:mt-12' : ''}`}
                  >
                    <h2
                      id={`archive-${group.key}-${index}`}
                      className="archive-month flex items-baseline gap-2 border-b border-[var(--border-strong)] pb-2 text-[var(--fg)] lg:sticky lg:top-24 lg:block lg:self-start lg:border-b-0 lg:border-t-2 lg:border-gold lg:pb-0 lg:pt-3"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      <span className="text-xl font-bold lg:block lg:text-2xl">{group.month}</span>
                      {group.year && <span className="text-base text-[var(--fg-muted)] lg:mt-0.5 lg:block">{group.year}</span>}
                    </h2>
                    <div className="divide-y divide-[var(--border)] lg:[&>article:first-child]:pt-0">
                      {group.articles.map((article, row) => (
                        // Without a lead article the first row's picture is the first one in view.
                        <ArchiveRow key={article.id} article={article} eager={!lead && index === 0 && row === 0} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <ArticleEmptyState
                state={emptyState}
                action={isFiltered ? { href: '/archive', label: '← Clear Filters' } : undefined}
              />
            )}

            {/* Pagination */}
            {totalPages > 1 && articles.length > 0 && (
              <nav
                aria-label="Archive pagination"
                className="mt-12 flex items-center justify-between gap-4 border-t border-[var(--border-strong)] pt-6"
              >
                {page > 1 ? (
                  <Link
                    href={buildArchiveHref(page - 1, q, categorySlug, tags)}
                    rel="prev"
                    aria-label="Previous page"
                    className="archive-page-link"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span aria-disabled="true" className="archive-page-link">
                    ← Previous
                  </span>
                )}
                <span className="text-xs uppercase tracking-widest text-[var(--fg-muted)]">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={buildArchiveHref(page + 1, q, categorySlug, tags)}
                    rel="next"
                    aria-label="Next page"
                    className="archive-page-link"
                  >
                    Next →
                  </Link>
                ) : (
                  <span aria-disabled="true" className="archive-page-link">
                    Next →
                  </span>
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  )
}
