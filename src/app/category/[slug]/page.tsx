import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
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
      where: { status: 'PUBLISHED', categoryId: category.id },
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
                <article className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden group card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
                  {/* Cover image */}
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
                    <div className="absolute top-3 left-3 z-10">
                      <span className="category-badge">{category.name}</span>
                    </div>
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
