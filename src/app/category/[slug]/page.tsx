import { notFound } from 'next/navigation'
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
    title: `${category.name} | The Consilium`,
    description: `Read all ${category.name} articles from The Consilium`,
  }
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params

  let category = null
  try {
    category = await prisma.category.findUnique({ where: { slug } })
  } catch {
    // DB not available — fall through to notFound
  }

  if (!category) notFound()

  type ArticleRow = Awaited<ReturnType<typeof prisma.article.findMany<{
    include: { author: true; category: true }
  }>>>[number]

  let articles: ArticleRow[] = []
  try {
    articles = await prisma.article.findMany({
      where: { status: 'PUBLISHED', categoryId: category.id, isDebate: false },
      orderBy: { publishedAt: 'desc' },
      include: { author: true, category: true },
    })
  } catch {
    articles = []
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <section className="bg-navy py-14 px-4 border-b border-gold/25">
        <div className="max-w-7xl mx-auto">
          <AnimateIn variant="fade-in" duration={0.4}>
            <p className="text-gold/60 text-[0.65rem] tracking-[0.4em] uppercase mb-3 font-semibold">
              Section
            </p>
          </AnimateIn>
          <AnimateIn variant="fade-up" delay={0.05} duration={0.6}>
            <h1
              className="text-4xl sm:text-5xl font-bold text-gold"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {category.name}
            </h1>
          </AnimateIn>
          <AnimateIn variant="fade-in" delay={0.15} duration={0.4}>
            <p className="text-cream/40 text-sm mt-2">
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
            <div className="py-24 text-center border border-dashed border-[var(--border)]">
              <p
                className="text-3xl font-bold text-[var(--fg-faint)] mb-3"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                Coming Soon
              </p>
              <p className="text-[var(--fg-faint)] text-sm">
                No {category.name.toLowerCase()} articles published yet. Check back soon.
              </p>
            </div>
          </AnimateIn>
        )}
      </div>
    </div>
  )
}
