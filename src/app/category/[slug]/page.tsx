import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { ArticleCard } from '@/components/ui/ArticleCard'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await prisma.category.findUnique({ where: { slug } }).catch(() => null)
  if (!category) return {}
  return {
    title: category.name,
    description: `Read all ${category.name} articles from The Consilium`,
  }
}

const SECTION_DESCRIPTIONS: Record<string, { icon: string; description: string }> = {
  interviews: {
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    description: 'In-depth conversations with economists, policymakers, and thought leaders. Coming soon.',
  },
  analysis: {
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    description: 'Rigorous economic analysis and research. Our writers are working on it.',
  },
  news: {
    icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z',
    description: 'Economic news and commentary. More articles are on the way.',
  },
  opinion: {
    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    description: 'Independent opinion and commentary. Our writers are crafting their arguments.',
  },
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params

  let category = null
  try {
    category = await prisma.category.findUnique({ where: { slug } })
  } catch {
    // DB not available - fall through to notFound
  }

  if (!category) notFound()

  type ArticleRow = Awaited<ReturnType<typeof prisma.article.findMany<{
    include: { author: true; category: true }
  }>>>[number]

  let articles: ArticleRow[] = []
  try {
    articles = await prisma.article.findMany({
      where: { status: 'PUBLISHED', categoryId: category.id, isDebate: false, deletedAt: null },
      orderBy: { publishedAt: 'desc' },
      include: { author: true, category: true },
    })
  } catch {
    articles = []
  }

  const emptyState = SECTION_DESCRIPTIONS[slug] ?? {
    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
    description: `No ${category.name.toLowerCase()} articles published yet. Check back soon.`,
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <section className="bg-navy py-14 px-4 border-b border-gold/25">
        <div className="max-w-7xl mx-auto">
          <AnimateIn variant="fade-in" duration={0.4}>
            <p className="text-gold/60 text-[0.65rem] tracking-[-0.01em] uppercase mb-3 font-semibold">
              Section
            </p>
          </AnimateIn>
          <AnimateIn variant="fade-up" delay={0.05} duration={0.6}>
            <h1
              className="text-4xl sm:text-5xl font-bold text-gold"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {category.name || slug.charAt(0).toUpperCase() + slug.slice(1)}
            </h1>
          </AnimateIn>
          <AnimateIn variant="fade-in" delay={0.15} duration={0.4}>
            <p className="text-cream/60 text-sm mt-2">
              {articles.length} article{articles.length !== 1 ? 's' : ''}
            </p>
          </AnimateIn>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {articles.length > 0 ? (
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {articles.map((article) => (
              <StaggerItem key={article.id}>
                <ArticleCard article={article} badgeLabel={category.name} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        ) : (
          <AnimateIn variant="fade-up">
            <div className="py-24 flex flex-col items-center text-center max-w-sm mx-auto">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center mb-6 border border-[var(--border)]">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-gold/70"
                >
                  <path d={emptyState.icon} />
                </svg>
              </div>
              <h2
                className="text-2xl font-bold text-[var(--fg)] mb-3"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {category.name} Coming Soon
              </h2>
              <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-8">
                {emptyState.description}
              </p>
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-[-0.01em] border border-gold/50 px-6 py-3 hover:bg-gold hover:text-navy transition-all duration-150"
              >
                ← Back to Homepage
              </Link>
            </div>
          </AnimateIn>
        )}
      </div>
    </div>
  )
}
