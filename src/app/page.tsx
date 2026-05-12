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
import { BlurImage } from '@/components/ui/BlurImage'
import { DebatePanel, type DebateData } from '@/components/ui/DebatePanel'
import { readTimeLabel } from '@/lib/readTime'
import { EconomicTicker } from '@/components/ui/EconomicTicker'
import { displayAuthorName } from '@/lib/authorUtils'
import type { Metadata } from 'next'
import { SITE_NAME, SITE_URL } from '@/lib/constants'

export const dynamic = 'force-dynamic'

async function getFeaturedArticle() {
  try {
    // First try explicitly featured, then fall back to most recent published
    // Debate articles are excluded - they live on /opinion-debate
    const featured = await prisma.article.findFirst({
      where: { status: 'PUBLISHED', isFeatured: true, isDebate: false, deletedAt: null },
      include: { author: true, category: true },
    })
    if (featured) return featured
    return await prisma.article.findFirst({
      where: { status: 'PUBLISHED', isDebate: false, deletedAt: null },
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
        where: { status: 'PUBLISHED', isDebate: false, deletedAt: null },
        orderBy: { viewCount: 'desc' },
        take: 5,
        select: { id: true, title: true, slug: true, viewCount: true, author: { select: { name: true } }, category: { select: { name: true } } },
      })
    }
    const ids = topIds.map((r) => r.articleId)
    const articles = await prisma.article.findMany({
      where: { id: { in: ids }, status: 'PUBLISHED', isDebate: false, deletedAt: null },
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
        deletedAt: null,
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
          deletedAt: null,
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
// Do NOT set a title here so the template does not double-wrap it.
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
  const websiteStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: 'Economics analysis, opinion, and research from the University of Edinburgh',
  }
  const organizationStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    description: 'The official publication of the University of Edinburgh Economics Society',
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationStructuredData) }}
      />
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
            <div className="overflow-hidden group card-hover transition-[transform,box-shadow] duration-150 ease-out">
              <div className="grid grid-cols-1 lg:grid-cols-2">
                {/* Image */}
                <div className="relative h-64 lg:h-auto lg:min-h-[400px] bg-navy-light overflow-hidden">
                  {featured.coverImage ? (
                    <BlurImage
                      src={featured.coverImage}
                      alt={featured.title}
                      fill
                      className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05]"
                      priority
                      sizes="(max-width: 1024px) 100vw, 50vw"
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
                  {/* Top row: category badge + read time */}
                  <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between">
                    {featured.category ? (
                      <span className="category-badge">{featured.category.name}</span>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <span className="flex items-center gap-1 bg-navy/70 text-cream/90 text-[10px] font-semibold px-2 py-1 backdrop-blur-sm leading-none">
                      <Clock size={9} className="shrink-0" />
                      {readTimeLabel(featured.content)}
                    </span>
                  </div>
                  {/* Gradient overlay bottom */}
                  <div className="absolute inset-0 bg-gradient-to-t from-navy/30 via-transparent to-transparent pointer-events-none" />
                </div>

                {/* Content */}
                <div className="p-8 lg:p-12 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-[var(--border)]">
                  <div className="text-gold/50 text-[0.65rem] tracking-[0.3em] uppercase mb-3 font-semibold">
                    Featured
                  </div>
                  <Link href={`/articles/${featured.slug}`}>
                    <h2
                      className="text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4 leading-tight transition-colors duration-200 hover:text-gold"
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
                      {displayAuthorName(featured.author.name)}
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
                    className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest group/link hover:gap-3 transition-[gap] duration-200 ease-out"
                  >
                    Read Article
                    <span className="inline-block transition-transform duration-200 ease-out group-hover/link:translate-x-1">
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
                <ArticleCard article={article} />
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

        {/* ── Debate Panel ─────────────────────────────────────────────────── */}
        {activeDebate && !categorySlug && (
          <AnimateIn variant="fade-up" delay={0.1} className="mt-14">
            <hr className="section-divider mb-14" />
            <DebatePanel initialData={activeDebate} />
          </AnimateIn>
        )}

        {/* ── Most Read This Week ─────────────────────────────────────────────── */}
        {mostRead.length > 1 && !categorySlug && (
          <AnimateIn variant="fade-up" delay={0.1} className="mt-14">
            <hr className="section-divider mb-14" />
            <div className="pt-0">
            <div className="flex items-center gap-3 mb-8">
              <span className="text-gold/50 text-[0.65rem] font-bold tracking-[-0.01em] uppercase">Most Read</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-[-0.01em]">This Week</span>
            </div>
            <div className="space-y-0 divide-y divide-[var(--border)]">
              {(mostRead.filter(Boolean) as { id: string; title: string; slug: string; viewCount: number; author: { name: string | null }; category: { name: string } | null }[]).map((article, i) => (
                article && (
                  <Link
                    key={article.id}
                    href={`/articles/${article.slug}`}
                    className="flex items-center gap-6 py-4 group hover:bg-[var(--bg-subtle)] -mx-2 px-2 transition-colors duration-150"
                  >
                    <span className="most-read-number shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-bold text-[var(--fg)] group-hover:text-gold transition-colors duration-150 line-clamp-2 text-base leading-snug"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {article.title}
                      </p>
                      <p className="text-[var(--fg-faint)] text-xs mt-1">
                        {displayAuthorName(article.author.name)}
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
            <hr className="section-divider mb-14" />
            <div className="pt-0">
              <div className="flex items-center gap-3 mb-6">
                <span className="text-gold/50 text-[0.65rem] font-bold tracking-[-0.01em] uppercase">Trending Topics</span>
                <div className="flex-1 h-px bg-[var(--border)]" />
                <span className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-[-0.01em]">Past 30 Days</span>
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <hr className="section-divider" />
      </div>
      <NewsletterSignup />
    </div>
  )
}
