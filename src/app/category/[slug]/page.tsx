import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
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

  type ArticleWithRelations = Awaited<ReturnType<typeof prisma.article.findMany<{
    include: { author: true; category: true }
  }>>>[number]

  let category = null
  let articles: ArticleWithRelations[] = []

  try {
    category = await prisma.category.findUnique({ where: { slug } })
  } catch {
    // DB not available
  }

  if (!category) notFound()

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
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <section className="bg-navy py-12 px-4 border-b-2 border-gold">
        <div className="max-w-7xl mx-auto">
          <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-2">Section</p>
          <h1
            className="text-4xl sm:text-5xl font-bold text-gold"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {category.name}
          </h1>
          <p className="text-cream/50 text-sm mt-2">
            {articles.length} article{articles.length !== 1 ? 's' : ''}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {articles.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {articles.map((article) => (
              <article
                key={article.id}
                className="bg-white border border-gold/15 overflow-hidden group hover:shadow-lg transition-shadow duration-300"
              >
                <div className="relative h-48 bg-navy/10 overflow-hidden">
                  {article.coverImage ? (
                    <Image
                      src={article.coverImage}
                      alt={article.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                      <span
                        className="text-gold/20 text-4xl font-bold"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        TC
                      </span>
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <span className="category-badge">{category.name}</span>
                  </div>
                </div>
                <div className="p-5">
                  <Link href={`/articles/${article.slug}`}>
                    <h3
                      className="text-lg font-bold text-navy mb-2 leading-snug hover:text-gold transition-colors line-clamp-2"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {article.title}
                    </h3>
                  </Link>
                  {article.excerpt && (
                    <p className="text-navy/55 text-sm leading-relaxed mb-4 line-clamp-2">
                      {article.excerpt}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs text-navy/45 border-t border-gold/15 pt-3 mt-3">
                    <span className="font-medium">{article.author.name}</span>
                    <span>
                      {article.publishedAt
                        ? format(new Date(article.publishedAt), 'd MMM yyyy')
                        : ''}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="py-24 text-center">
            <p
              className="text-4xl font-bold text-navy/20 mb-3"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Coming Soon
            </p>
            <p className="text-navy/40 text-sm">
              No {category.name.toLowerCase()} articles published yet. Check back soon.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
