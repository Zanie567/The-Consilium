import Link from 'next/link'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { Clock } from 'lucide-react'
import { ClientDate } from '@/components/ui/ClientDate'
import { format } from 'date-fns'
import { NewsletterSignup } from '@/components/ui/NewsletterSignup'
import { CategoryTabs } from '@/components/ui/CategoryTabs'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { ContinueReading } from '@/components/ui/ContinueReading'
import { ArticleCard } from '@/components/ui/ArticleCard'
import { BookmarkButton } from '@/components/ui/BookmarkButton'
import { BlurImage } from '@/components/ui/BlurImage'
import { DebatePanel, type DebateData } from '@/components/ui/DebatePanel'
import { readTimeLabel } from '@/lib/readTime'
import { EconomicTicker } from '@/components/ui/EconomicTicker'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

async function getFeaturedArticle() {
  try {
    // First try explicitly featured, then fall back to most recent published
    // Debate articles are excluded - they live on /opinion-debate
    const featured = await prisma.article.findFirst({
      where: { status: 'PUBLISHED', isFeatured: true, isDebate: false },
      include: { author: true, category: true },
    })
    if (featured) return featured
    return await prisma.article.findFirst({
      where: { status: 'PUBLISHED', isDebate: false },
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
    const topIds = await prisma.articleView.groupBy({
      by: ['articleId'],
      where: { viewedAt: { gte: weekAgo } },
      _count: { articleId: true },
      orderBy: { _count: { articleId: 'desc' } },
      take: 5,
    })
    if (topIds.length === 0) {
      return prisma.article.findMany({
        where: { status: 'PUBLISHED', isDebate: false },
        orderBy: { viewCount: 'desc' },
        take: 5,
        select: { id: true, title: true, slug: true, viewCount: true, author: { select: { name: true } }, category: { select: { name: true } } },
      })
    }
    const ids = topIds.map((r) => r.articleId)
    const articles = await prisma.article.findMany({
      where: { id: { in: ids }, status: 'PUBLISHED', isDebate: false },
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
        isDebate: false,
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

function estimateReadTime(content: string): string {
  try {
    const words = JSON.stringify(JSON.parse(content)).split(/\s+/).length
    return `${Math.max(1, Math.round(words / 200))} min read`
  } catch {
    return `${Math.max(1, Math.round(content.split(/\s+/).length / 200))} min read`
  }
}

async function getActiveDebate(userId?: string, anonymousId?: string): Promise<DebateData | null> {
  try {
    const debate = await prisma.debate.findFirst({
      where: { isActive: true },
      include: {
        forArticle: { select: { id: true, title: true, slug: true, excerpt: true, content: true, author: { select: { name: true } } } },
        againstArticle: { select: { id: true, title: true, slug: true, excerpt: true, content: true, author: { select: { name: true } } } },
        _count: { select: { votes: true } },
      },
    })
    if (!debate) return null

    const isClosed = debate.closesAt ? new Date() > debate.closesAt : false

    let existingVote: { side: string } | null = null
    if (userId) {
      existingVote = await prisma.debateVote.findFirst({ where: { debateId: debate.id, userId }, select: { side: true } })
    } else if (anonymousId) {
      existingVote = await prisma.debateVote.findFirst({ where: { debateId: debate.id, anonymousId }, select: { side: true } })
    }

    const hasVoted = existingVote !== null || isClosed
    let forPct = 0, againstPct = 0, forCount = 0, againstCount = 0

    if (hasVoted) {
      const counts = await prisma.debateVote.groupBy({
        by: ['side'], where: { debateId: debate.id }, _count: { side: true },
      })
      forCount = counts.find((c) => c.side === 'FOR')?._count.side ?? 0
      againstCount = counts.find((c) => c.side === 'AGAINST')?._count.side ?? 0
      const total = forCount + againstCount
      forPct = total > 0 ? Math.round((forCount / total) * 100) : 0
      againstPct = total > 0 ? 100 - forPct : 0
    }

    return {
      id: debate.id,
      title: debate.title,
      description: debate.description,
      isClosed,
      closesAt: debate.closesAt?.toISOString() ?? null,
      forArticle: {
        id: debate.forArticle.id,
        title: debate.forArticle.title,
        slug: debate.forArticle.slug,
        excerpt: debate.forArticle.excerpt,
        author: debate.forArticle.author.name,
        readTime: estimateReadTime(debate.forArticle.content),
      },
      againstArticle: {
        id: debate.againstArticle.id,
        title: debate.againstArticle.title,
        slug: debate.againstArticle.slug,
        excerpt: debate.againstArticle.excerpt,
        author: debate.againstArticle.author.name,
        readTime: estimateReadTime(debate.againstArticle.content),
      },
      hasVoted,
      userSide: (existingVote?.side as 'FOR' | 'AGAINST') ?? null,
      totalVotes: debate._count.votes,
      ...(hasVoted && { forCount, againstCount, forPct, againstPct }),
    }
  } catch {
    return null
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

// Title is inherited from layout's `default` ("The Consilium | University of Edinburgh Economics Society")
// — do NOT set a title here so the template does not double-wrap it.
export const metadata: Metadata = {
  description: 'Economics analysis, opinion, and research from the University of Edinburgh.',
  openGraph: {
    title: 'The Consilium',
    description: 'The voice of the University of Edinburgh Economics Society.',
  },
  twitter: {
    card: 'summary',
    title: 'The Consilium',
    description: 'The voice of the University of Edinburgh Economics Society.',
  },
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const params = await searchParams
  const categorySlug = params.category

  // Fetch debate server-side so it's in the HTML for SEO
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const anonymousId = cookieStore.get('consilium_anon_id')?.value

  const [featured, articles, categories, mostRead, trendingTags, activeDebate] = await Promise.all([
    getFeaturedArticle(),
    getArticles(categorySlug),
    getCategories(),
    getMostReadArticles(),
    getTrendingTags(),
    getActiveDebate(session?.user?.id, anonymousId),
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
            <p className="text-gold/60 text-[0.65rem] tracking-[0.2em] sm:tracking-[0.4em] uppercase mb-3 font-semibold leading-relaxed">
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
            <p className="text-cream/60 text-sm tracking-wide max-w-xs sm:max-w-none mx-auto leading-relaxed">
              The voice of the University of Edinburgh Economics Society
            </p>
          </AnimateIn>
        </div>
      </section>

      {/* ── Date banner ────────────────────────────────────────────────────── */}
      <div className="bg-[var(--bg-subtle)] border-b border-[var(--border)] px-4 py-2 text-center">
        <span className="text-[var(--fg-faint)] text-[0.65rem] tracking-widest uppercase font-bold">
          <ClientDate />
        </span>
      </div>

      {/* ── Economic data ticker ───────────────────────────────────────────── */}
      <EconomicTicker />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* ── Featured Article ─────────────────────────────────────────────── */}
        {featured ? (
          <AnimateIn variant="fade-up" duration={0.6} className="mb-14">
            <div className="relative h-[320px] md:h-[560px] w-full overflow-hidden group card-hover shadow-[var(--shadow-card)]">
              {/* Full-bleed image or navy fallback */}
              {featured.coverImage ? (
                <BlurImage
                  src={featured.coverImage}
                  alt={featured.title}
                  fill
                  className="object-cover object-center"
                  priority
                  sizes="100vw"
                />
              ) : (
                <div className="absolute inset-0 bg-navy" />
              )}

              {/* Dark gradient over bottom half for text legibility */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.75) 100%)' }}
              />

              {/* Top row: category badge (left) + FEATURED label + read time (right) */}
              <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between">
                {featured.category ? (
                  <span className="category-badge">{featured.category.name}</span>
                ) : (
                  <span aria-hidden="true" />
                )}
                <div className="flex items-center gap-2">
                  <span className="text-gold/80 text-[0.6rem] tracking-[0.25em] uppercase font-bold bg-navy/60 px-2 py-1 backdrop-blur-sm">
                    Featured
                  </span>
                  <span className="flex items-center gap-1 bg-navy/70 text-cream/90 text-[10px] font-semibold px-2 py-1 backdrop-blur-sm leading-none">
                    <Clock size={9} className="shrink-0" />
                    {readTimeLabel(featured.content)}
                  </span>
                </div>
              </div>

              {/* Text overlay — bottom left */}
              <div className="absolute bottom-0 left-0 right-0 z-10 p-6 md:p-10">
                <Link href={`/articles/${featured.slug}`}>
                  <h2
                    className="text-2xl md:text-4xl lg:text-5xl font-bold text-white mb-3 leading-tight hover:text-gold transition-colors duration-200 max-w-3xl"
                    style={{ fontFamily: 'var(--font-serif)' }}
                  >
                    {featured.title}
                  </h2>
                </Link>
                {featured.excerpt && (
                  <p className="text-white/80 text-sm md:text-base leading-relaxed mb-4 max-w-2xl line-clamp-2 hidden sm:block">
                    {featured.excerpt}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-white/70 mb-5">
                  <span className="font-semibold text-white/90">
                    {featured.author.name}
                  </span>
                  <span className="text-gold/60">·</span>
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
          <StaggerContainer className="mt-2 space-y-6">
            {/* Lead card — first article, full-width row, image left 60% / text right 40% */}
            <StaggerItem>
              <Link href={`/articles/${gridArticles[0].slug}`} className="block group">
                <article className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden card-hover shadow-[var(--shadow-card)] flex flex-col sm:flex-row h-auto sm:h-[320px]">
                  {/* Image — full width on mobile, 60% on sm+ */}
                  <div className="relative h-52 sm:h-full sm:w-[60%] bg-navy/10 dark:bg-navy/20 overflow-hidden img-zoom flex-shrink-0">
                    {gridArticles[0].coverImage ? (
                      <BlurImage
                        src={gridArticles[0].coverImage}
                        alt={gridArticles[0].title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 100vw, 60vw"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                        <span
                          className="text-gold/15 text-5xl font-bold select-none"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          TC
                        </span>
                      </div>
                    )}
                    {/* Top overlay row: category badge (left) + read time (right) */}
                    <div className="absolute top-0 left-0 right-0 z-10 flex items-start justify-between p-3">
                      {gridArticles[0].category ? (
                        <span className="category-badge">{gridArticles[0].category.name}</span>
                      ) : (
                        <span aria-hidden="true" />
                      )}
                      <span className="flex items-center gap-1 bg-navy/70 text-cream/90 text-[10px] font-semibold px-2 py-1 backdrop-blur-sm leading-none">
                        <Clock size={9} className="shrink-0" />
                        {readTimeLabel(gridArticles[0].content)}
                      </span>
                    </div>
                  </div>

                  {/* Text — 40% on sm+ */}
                  <div className="p-6 sm:p-8 flex flex-col justify-center sm:w-[40%] flex-1">
                    <h3
                      className="text-xl sm:text-2xl font-bold text-[var(--fg)] mb-3 leading-snug group-hover:text-gold transition-colors duration-200 line-clamp-3"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {gridArticles[0].title}
                    </h3>
                    {gridArticles[0].excerpt && (
                      <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-5 line-clamp-3">
                        {gridArticles[0].excerpt}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[0.7rem] text-[var(--fg-faint)] border-t border-[var(--border)] pt-3 mt-auto">
                      <span className="font-semibold text-[var(--fg-muted)]">{gridArticles[0].author.name}</span>
                      <div className="flex items-center gap-3">
                        <span>
                          {gridArticles[0].publishedAt
                            ? format(new Date(gridArticles[0].publishedAt), 'd MMM yyyy')
                            : ''}
                        </span>
                        <BookmarkButton articleId={gridArticles[0].id} />
                      </div>
                    </div>
                  </div>
                </article>
              </Link>
            </StaggerItem>

            {/* Remaining articles — three-column grid */}
            {gridArticles.length > 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {gridArticles.slice(1).map((article) => (
                  <StaggerItem key={article.id}>
                    <ArticleCard article={article} />
                  </StaggerItem>
                ))}
              </div>
            )}
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

        {/* ── Debate Panel ─────────────────────────────────────────────────── */}
        {activeDebate && !categorySlug && (
          <AnimateIn variant="fade-up" delay={0.1} className="mt-14">
            <DebatePanel initialData={activeDebate} />
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
