import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { displayAuthorName } from '@/lib/authorUtils'
import { SITE_URL } from '@/lib/constants'
import {
  ARCHIVE_PAGE_SIZE,
  buildArchiveHref,
  clampPage,
  escapeLikePattern,
  normaliseCategorySlug,
  normaliseSearchTerm,
  pageOffset,
  parsePageParam,
  totalPageCount,
  type SearchParamValue,
} from '@/lib/archivePagination'

interface Props {
  // Each value is `string | string[] | undefined`, because Next resolves a
  // repeated query parameter (`?q=a&q=b`) to an array. Declaring these as plain
  // strings is what previously let an array reach Prisma, where it threw and
  // turned a crafted URL into a 500.
  searchParams: Promise<{
    q?: SearchParamValue
    category?: SearchParamValue
    page?: SearchParamValue
  }>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams
  const q = normaliseSearchTerm(params.q)
  const categorySlug = normaliseCategorySlug(params.category)
  const page = parsePageParam(params.page)

  return {
    title: page > 1 ? `Archive — Page ${page}` : 'Archive',
    description: 'Browse all published articles from The Consilium.',
    alternates: {
      // Self-referencing canonical. Metadata is merged shallowly, so without
      // this every archive URL inherits the root layout's site-wide canonical
      // and declares itself a duplicate of the homepage. Re-declare the RSS
      // alternate here too, since setting `alternates` replaces it wholesale.
      canonical: buildArchiveHref(page, q, categorySlug),
      types: { 'application/rss+xml': `${SITE_URL}/feed.xml` },
    },
    // Search and category permutations are unbounded crawl space, and page 2+
    // is a thin slice of the same listing. Keep them followable but unindexed.
    robots:
      q || categorySlug || page > 1
        ? { index: false, follow: true }
        : { index: true, follow: true },
  }
}

function archiveWhere(q?: string, categorySlug?: string) {
  // "View all" — the complete published set, debates included.
  //
  // The search term is LIKE-escaped before it reaches `contains`: Prisma
  // compiles that to `ILIKE ('%' || $n || '%')`, so an unescaped `%` or `_`
  // from the query string would be read as a wildcard instead of as the text
  // the reader typed.
  const term = q ? escapeLikePattern(q) : undefined
  return publishedArticleWhere({
    ...(term
      ? {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { excerpt: { contains: term, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
  })
}

// Both queries return null rather than a fallback value when the database is
// unreachable. Returning 0/[] would render "0 articles published" over an empty
// archive and read as "we have published nothing", which is why the count's
// original catch was removed; letting the error escape instead produced a 500,
// breaking the degrade-to-HTTP-200 contract documented in src/lib/prisma.ts.
// A null lets the page say plainly that it could not load.
async function getArticleCount(q?: string, categorySlug?: string): Promise<number | null> {
  try {
    return await prisma.article.count({ where: archiveWhere(q, categorySlug) })
  } catch {
    return null
  }
}

async function getArticles(q: string | undefined, categorySlug: string | undefined, page: number) {
  try {
    return await prisma.article.findMany({
      where: archiveWhere(q, categorySlug),
      // `id` is the tiebreaker that keeps paging stable when several articles
      // share a publish timestamp. `nulls: 'last'` keeps a published-but-undated
      // article from pinning itself to the top of page 1, since Postgres sorts
      // NULLs first on DESC.
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      // Only the names are rendered. `author: true` pulled every user column —
      // email, ban reason, admin notes, lockout state — into the render for
      // each of the 20 rows; none of it reached the HTML, but none of it needs
      // to be fetched either.
      include: { author: { select: { name: true } }, category: { select: { name: true } } },
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

export default async function ArchivePage({ searchParams }: Props) {
  const params = await searchParams
  const q = normaliseSearchTerm(params.q)
  const categorySlug = normaliseCategorySlug(params.category)
  const requestedPage = parsePageParam(params.page)

  const [total, categories] = await Promise.all([getArticleCount(q, categorySlug), getCategories()])

  const totalPages = totalPageCount(total ?? 0)
  const page = clampPage(requestedPage, totalPages)
  const articles = total === null ? null : await getArticles(q, categorySlug, page)
  const loadFailed = total === null || articles === null

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <AnimateIn variant="fade-in" duration={0.4}>
          <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">Browse</p>
        </AnimateIn>
        <AnimateIn variant="fade-up" delay={0.08} duration={0.6}>
          <h1
            className="text-4xl sm:text-5xl font-bold text-gold"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Archive
          </h1>
        </AnimateIn>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Search + Filter.

            A GET form with no `action` submits to the current path with a query
            string built only from its own fields, so `page` is dropped and a new
            search correctly starts at page 1. Do not add a hidden page input —
            that is what would strand the reader on a stale page number. */}
        <AnimateIn variant="fade-up" duration={0.45}>
          <form method="GET" className="flex flex-col sm:flex-row gap-3 mb-10">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search articles..."
              className="flex-1 border border-[var(--border)] px-4 py-2.5 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg-elevated)]"
            />
            <select
              name="category"
              defaultValue={categorySlug ?? ''}
              className="border border-[var(--border)] px-4 py-2.5 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg-elevated)]"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.slug}>
                  {cat.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-navy text-gold px-6 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
            >
              Search
            </button>
          </form>
        </AnimateIn>

        {loadFailed ? (
          /* Surface the failure instead of silently rendering "0 articles" */
          <div className="bg-red-500/10 border border-red-500/20 px-5 py-4 text-red-600 dark:text-red-400 text-sm">
            We couldn&apos;t load the archive. Please refresh the page to try again.
          </div>
        ) : (
          <>
            {/* Results count */}
            <AnimateIn variant="fade-in" delay={0.1}>
              <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-6">
                {total} article{total !== 1 ? 's' : ''} {q ? `matching "${q}"` : 'published'}
              </p>
            </AnimateIn>

            {/* Articles list - each item animates individually as it enters the viewport */}
            {articles.length > 0 ? (
              <div className="divide-y divide-gold/15">
                {articles.map((article, i) => (
                  <AnimateIn
                    key={article.id}
                    variant="fade-up"
                    delay={Math.min(i * 0.04, 0.3)}
                    duration={0.45}
                  >
                    <Link
                      href={`/articles/${article.slug}`}
                      className="py-6 flex flex-col sm:flex-row sm:items-start gap-4 group hover:bg-[var(--bg-subtle)] -mx-2 px-2 transition-colors"
                    >
                      <div className="sm:w-32 shrink-0 text-xs text-[var(--fg-faint)] pt-1">
                        {article.publishedAt
                          ? format(new Date(article.publishedAt), 'd MMM yyyy')
                          : ''}
                      </div>
                      <div className="flex-1">
                        {article.category && (
                          <span className="category-badge mb-2 inline-block">
                            {article.category.name}
                          </span>
                        )}
                        <h3
                          className="text-lg font-bold text-[var(--fg)] group-hover:text-gold transition-colors leading-snug mb-1"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          {article.title}
                        </h3>
                        {article.excerpt && (
                          <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-2 line-clamp-2">
                            {article.excerpt}
                          </p>
                        )}
                        <p className="text-[var(--fg-faint)] text-xs">
                          By {displayAuthorName(article.author.name)}
                        </p>
                      </div>
                    </Link>
                  </AnimateIn>
                ))}
              </div>
            ) : (
              <AnimateIn variant="fade-up">
                <div className="py-20 text-center">
                  <p className="text-[var(--fg-faint)] text-sm uppercase tracking-widest">
                    No articles found
                  </p>
                </div>
              </AnimateIn>
            )}

            {/* Pagination */}
            {totalPages > 1 && articles.length > 0 && (
              <nav
                aria-label="Archive pagination"
                className="flex items-center justify-between mt-10 pt-6 border-t border-[var(--border)]"
              >
                {page > 1 ? (
                  <Link
                    href={buildArchiveHref(page - 1, q, categorySlug)}
                    rel="prev"
                    aria-label="Previous page"
                    className="text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:text-gold transition-colors"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="text-xs font-bold uppercase tracking-widest text-[var(--fg-faint)] opacity-60"
                  >
                    ← Previous
                  </span>
                )}
                <span className="text-[var(--fg-faint)] text-xs uppercase tracking-widest">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={buildArchiveHref(page + 1, q, categorySlug)}
                    rel="next"
                    aria-label="Next page"
                    className="text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:text-gold transition-colors"
                  >
                    Next →
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="text-xs font-bold uppercase tracking-widest text-[var(--fg-faint)] opacity-60"
                  >
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
