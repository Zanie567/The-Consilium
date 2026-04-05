import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { NewsletterSignup } from '@/components/ui/NewsletterSignup'
import { CategoryTabs } from '@/components/ui/CategoryTabs'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { ContinueReading } from '@/components/ui/ContinueReading'

async function getFeaturedArticle() {
  try {
    // First try explicitly featured, then fall back to most recent published
    const featured = await prisma.article.findFirst({
      where: { status: 'PUBLISHED', isFeatured: true },
      include: { author: true, category: true },
    })
    if (featured) return featured
    return await prisma.article.findFirst({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      include: { author: true, category: true },
    })
  } catch {
    return null
  }
}

async function getMostReadArticles() {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    // Get articles with most views in the last 7 days
    const topIds = await prisma.articleView.groupBy({
      by: ['articleId'],
      where: { viewedAt: { gte: weekAgo } },
      _count: { articleId: true },
      orderBy: { _count: { articleId: 'desc' } },
      take: 5,
    })
    if (topIds.length === 0) {
      // Fall back to all-time view count
      return prisma.article.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { viewCount: 'desc' },
        take: 5,
        select: { id: true, title: true, slug: true, viewCount: true, author: { select: { name: true } }, category: { select: { name: true } } },
      })
    }
    const ids = topIds.map((r) => r.articleId)
    const articles = await prisma.article.findMany({
      where: { id: { in: ids }, status: 'PUBLISHED' },
      select: { id: true, title: true, slug: true, viewCount: true, author: { select: { name: true } }, category: { select: { name: true } } },
    })
    // Sort by weekly views order
    return ids.map((id) => articles.find((a) => a.id === id)).filter(Boolean)
  } catch {
    return []
  }
}

async function getArticles(categorySlug?: string) {
  try {
    return await prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 12,
      include: { author: true, category: true },
    })
  } catch {
    return []
  }
}

async function getCategories() {
  try {
    return await prisma.category.findMany({ orderBy: { name: 'asc' } })
  } catch {
    return []
  }
}

async function getTrendingTags() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    // Get tags on articles published in the last 30 days, ordered by view count
    const rows = await prisma.articleTag.findMany({
      where: {
        article: {
          status: 'PUBLISHED',
          publishedAt: { gte: thirtyDaysAgo },
        },
      },
      include: {
        tag: true,
        article: { select: { viewCount: true } },
      },
    })
    // Aggregate view counts per tag
    const tally = new Map<string, { tag: { id: string; name: string; slug: string }; views: number; count: number }>()
    for (const row of rows) {
      const key = row.tagId
      const existing = tally.get(key)
      if (existing) {
        existing.views += row.article.viewCount
        existing.count += 1
      } else {
        tally.set(key, { tag: row.tag, views: row.article.viewCount, count: 1 })
      }
    }
    return Array.from(tally.values())
      .sort((a, b) => b.views + b.count * 2 - (a.views + a.count * 2))
      .slice(0, 8)
  } catch {
    return []
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const params = await searchParams
  const categorySlug = params.category

  const [featured, articles, categories, mostRead, trendingTags] = await Promise.all([
    getFeaturedArticle(),
    getArticles(categorySlug),
    getCategories(),
    getMostReadArticles(),
    getTrendingTags(),
  ])

  const gridArticles = featured
    ? articles.filter((a) => a.id !== featured.id)
    : articles

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* ── Masthead Hero ──────────────────────────────────────────────────── */}
      <section className="bg-navy text-cream py-7 px-4 text-center border-b border-gold/25 relative overflow-hidden">
        {/* Subtle dot grid */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, #c9a227 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative">
          <AnimateIn variant="fade-in" duration={0.5}>
            <p className="text-gold/60 text-[0.65rem] tracking-[0.4em] uppercase mb-3 font-semibold">
              University of Edinburgh Economics Society
            </p>
          </AnimateIn>
          <AnimateIn variant="fade-up" delay={0.08} duration={0.7}>
            <h1
              className="text-4xl sm:text-5xl md:text-6xl font-bold text-gold tracking-wider mb-3 leading-none"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              The Consilium
            </h1>
          </AnimateIn>
          <AnimateIn variant="fade-in" delay={0.2} duration={0.6}>
            <div className="w-16 h-px bg-gradient-to-r from-transparent via-gold to-transparent mx-auto mb-3 opacity-60" />
            <p className="text-cream/60 text-sm tracking-wide whitespace-nowrap mx-auto leading-relaxed">
              The voice of the University of Edinburgh Economics Society
            </p>
          </AnimateIn>
        </div>
      </section>

      {/* ── Date banner ────────────────────────────────────────────────────── */}
      <div className="bg-[var(--bg-subtle)] border-b border-[var(--border)] px-4 py-2 text-center">
        <span className="text-[var(--fg-faint)] text-[0.65rem] tracking-widest uppercase font-bold">
          {format(new Date(), 'EEEE, d MMMM yyyy')}
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* ── Featured Article ─────────────────────────────────────────────── */}
        {featured ? (
          <AnimateIn variant="fade-up" duration={0.6} className="mb-14">
            <div className="border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden group card-hover shadow-[var(--shadow-card)]">
              <div className="grid grid-cols-1 lg:grid-cols-2">
                {/* Image */}
                <div className="relative h-64 lg:h-auto lg:min-h-[400px] bg-navy-light overflow-hidden img-zoom">
                  {featured.coverImage ? (
                    <Image
                      src={featured.coverImage}
                      alt={featured.title}
                      fill
                      className="object-cover"
                      priority
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-navy via-navy-light to-navy flex items-center justify-center">
                      <span
                        className="text-gold/15 text-8xl font-bold select-none"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        TC
                      </span>
                    </div>
                  )}
                  {featured.category && (
                    <div className="absolute top-4 left-4 z-10">
                      <span className="category-badge">{featured.category.name}</span>
                    </div>
                  )}
                  {/* Gradient overlay bottom */}
                  <div className="absolute inset-0 bg-gradient-to-t from-navy/30 via-transparent to-transparent pointer-events-none" />
                </div>

                {/* Content */}
                <div className="p-8 lg:p-12 flex flex-col justify-center bg-[var(--bg-elevated)]">
                  <div className="text-gold/50 text-[0.65rem] tracking-[0.3em] uppercase mb-3 font-semibold">
                    Featured
                  </div>
                  <Link href={`/articles/${featured.slug}`}>
                    <h2
                      className="text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4 leading-tight hover:text-gold transition-colors duration-200"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {featured.title}
                    </h2>
                  </Link>
                  {featured.excerpt && (
                    <p className="text-[var(--fg-muted)] text-base leading-relaxed mb-6">
                      {featured.excerpt}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-[var(--fg-faint)] mb-7">
                    <span className="font-semibold text-[var(--fg-muted)]">
                      {featured.author.name}
                    </span>
                    <span className="text-gold/40">·</span>
                    <span>
                      {featured.publishedAt
                        ? format(new Date(featured.publishedAt), 'd MMMM yyyy')
                        : ''}
                    </span>
                  </div>
                  <Link
                    href={`/articles/${featured.slug}`}
                    className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest group/link hover:gap-3 transition-all duration-200"
                  >
                    Read Article
                    <span className="inline-block transition-transform duration-200 group-hover/link:translate-x-1">
                      →
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </AnimateIn>
        ) : (
          <AnimateIn variant="fade-up" className="mb-14">
            <div className="py-20 text-center border border-dashed border-[var(--border)]">
              <p
                className="text-4xl font-bold text-[var(--fg-faint)] mb-3"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                No articles yet
              </p>
              <p className="text-[var(--fg-faint)] text-sm">
                Check back soon for our latest publications.
              </p>
            </div>
          </AnimateIn>
        )}

        {/* ── Category Tabs ────────────────────────────────────────────────── */}
        <AnimateIn variant="fade-in" delay={0.1}>
          <CategoryTabs categories={categories} currentSlug={categorySlug} />
        </AnimateIn>

        {/* ── Article Grid ─────────────────────────────────────────────────── */}
        {gridArticles.length > 0 ? (
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-2">
            {gridArticles.map((article) => (
              <StaggerItem key={article.id}>
                <article className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden group card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
                  {/* Cover Image */}
                  <div className="relative h-48 bg-navy/10 overflow-hidden img-zoom flex-shrink-0">
                    {article.coverImage ? (
                      <Image
                        src={article.coverImage}
                        alt={article.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                        <span
                          className="text-gold/15 text-4xl font-bold select-none"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          TC
                        </span>
                      </div>
                    )}
                    {article.category && (
                      <div className="absolute top-3 left-3 z-10">
                        <span className="category-badge">{article.category.name}</span>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-5 flex flex-col flex-1">
                    <Link href={`/articles/${article.slug}`} className="flex-1">
                      <h3
                        className="text-base font-bold text-[var(--fg)] mb-2 leading-snug group-hover:text-gold transition-colors duration-200 line-clamp-2"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {article.title}
                      </h3>
                    </Link>
                    {article.excerpt && (
                      <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-4 line-clamp-2">
                        {article.excerpt}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[0.7rem] text-[var(--fg-faint)] border-t border-[var(--border)] pt-3 mt-auto">
                      <span className="font-semibold text-[var(--fg-muted)]">
                        {article.author.name}
                      </span>
                      <span>
                        {article.publishedAt
                          ? format(new Date(article.publishedAt), 'd MMM yyyy')
                          : ''}
                      </span>
                    </div>
                  </div>
                </article>
              </StaggerItem>
            ))}
          </StaggerContainer>
        ) : (
          <AnimateIn variant="fade-in">
            <div className="py-20 text-center">
              <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest">
                {categorySlug
                  ? 'No articles in this category yet'
                  : 'No articles published yet'}
              </p>
            </div>
          </AnimateIn>
        )}

        {/* View all */}
        {gridArticles.length >= 11 && (
          <AnimateIn variant="fade-up" delay={0.1} className="mt-12 text-center">
            <Link
              href="/archive"
              className="inline-block border border-[var(--fg)] text-[var(--fg)] text-xs font-bold uppercase tracking-widest px-10 py-3.5 hover:bg-navy hover:text-gold hover:border-navy dark:hover:bg-gold dark:hover:text-navy dark:hover:border-gold transition-all duration-200 btn-lift"
            >
              View All Articles
            </Link>
          </AnimateIn>
        )}

        {/* ── Most Read This Week ─────────────────────────────────────────────── */}
        {mostRead.length > 0 && !categorySlug && (
          <AnimateIn variant="fade-up" delay={0.1} className="mt-14">
            <div className="border-t border-[var(--border)] pt-10">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-gold/50 text-[0.65rem] font-bold tracking-[0.3em] uppercase">Most Read</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-widest">This Week</span>
            </div>
            <div className="space-y-0 divide-y divide-[var(--border)]">
              {(mostRead.filter(Boolean) as { id: string; title: string; slug: string; viewCount: number; author: { name: string | null }; category: { name: string } | null }[]).map((article, i) => (
                article && (
                  <Link
                    key={article.id}
                    href={`/articles/${article.slug}`}
                    className="flex items-center gap-5 py-4 group hover:bg-[var(--bg-subtle)] -mx-2 px-2 transition-colors"
                  >
                    <span
                      className="text-3xl font-bold shrink-0 w-8 text-center"
                      style={{
                        fontFamily: 'var(--font-serif)',
                        color: i === 0 ? '#c9a227' : 'rgba(26,39,68,0.18)',
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-semibold text-[var(--fg)] group-hover:text-gold transition-colors line-clamp-1 text-sm"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {article.title}
                      </p>
                      <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                        {article.author.name}
                        {article.category && ` · ${article.category.name}`}
                      </p>
                    </div>
                  </Link>
                )
              ))}
            </div>
          </div>
          </AnimateIn>
        )}

        {/* ── Trending Topics ──────────────────────────────────────────────── */}
        {trendingTags.length > 0 && !categorySlug && (
          <AnimateIn variant="fade-up" delay={0.1} className="mt-14">
            <div className="border-t border-[var(--border)] pt-10">
              <div className="flex items-center gap-3 mb-6">
                <span className="text-gold/50 text-[0.65rem] font-bold tracking-[0.3em] uppercase">Trending Topics</span>
                <div className="flex-1 h-px bg-[var(--border)]" />
                <span className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-widest">Past 30 Days</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {trendingTags.map(({ tag }) => (
                  <Link
                    key={tag.id}
                    href={`/tag/${tag.slug}`}
                    className="px-4 py-2 border border-[var(--border)] text-[var(--fg-muted)] text-xs font-semibold hover:border-gold hover:text-gold transition-colors duration-200"
                  >
                    {tag.name}
                  </Link>
                ))}
              </div>
            </div>
          </AnimateIn>
        )}

        {/* ── Continue Reading ──────────────────────────────────────────────── */}
        {!categorySlug && (
          <ContinueReading />
        )}
      </div>

      {/* ── Newsletter ───────────────────────────────────────────────────────── */}
      <NewsletterSignup />
    </div>
  )
}
