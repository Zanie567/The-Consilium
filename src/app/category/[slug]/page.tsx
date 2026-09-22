import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { publishedArticleWhere, ARTICLES_CACHE_TAG, ARTICLES_REVALIDATE_SECONDS } from '@/lib/articleQueries'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { ArticleCard } from '@/components/ui/ArticleCard'
import { ArticleEmptyState } from '@/components/ui/ArticleEmptyState'
import { getSectionEmptyState } from '@/lib/sectionEmptyStates'
import type { Metadata } from 'next'
import { canonicalAlternates } from '@/lib/seo'

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
    alternates: canonicalAlternates(`/category/${category.slug}`),
  }
}

// Cached per category id. A burst of prefetch/navigation requests for the same
// category is served from the Next data cache instead of re-querying Postgres
// on every request (Priority 2). Busted immediately by revalidateTag on publish.
const getCachedCategoryArticles = unstable_cache(
  (categoryId: string) =>
    prisma.article.findMany({
      // Every published article in this category, INCLUDING debate articles.
      // The old `isDebate: false` filter hid 6 of 7 published Opinion pieces.
      where: publishedArticleWhere({ categoryId }),
      orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
      include: { author: true, category: true },
    }),
  ['category-articles'],
  { revalidate: ARTICLES_REVALIDATE_SECONDS, tags: [ARTICLES_CACHE_TAG] },
)

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
    articles = await getCachedCategoryArticles(category.id)
  } catch {
    articles = []
  }

  const emptyState = getSectionEmptyState(slug, category.name)

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
          <ArticleEmptyState
            state={emptyState}
            action={{ href: '/', label: '← Back to Homepage' }}
          />
        )}
      </div>
    </div>
  )
}
