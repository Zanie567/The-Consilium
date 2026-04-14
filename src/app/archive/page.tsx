import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { AnimateIn } from '@/components/ui/AnimateIn'

export const metadata: Metadata = {
  title: 'Archive',
  description: 'Browse all published articles from The Consilium.',
}

interface Props {
  searchParams: Promise<{ q?: string; category?: string }>
}

async function getArticles(q?: string, categorySlug?: string) {
  try {
    return await prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { excerpt: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
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

export default async function ArchivePage({ searchParams }: Props) {
  const params = await searchParams
  const { q, category: categorySlug } = params

  const [articles, categories] = await Promise.all([
    getArticles(q, categorySlug),
    getCategories(),
  ])

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
        {/* Search + Filter */}
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

        {/* Results count */}
        <AnimateIn variant="fade-in" delay={0.1}>
          <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-6">
            {articles.length} article{articles.length !== 1 ? 's' : ''}{' '}
            {q ? `matching "${q}"` : 'published'}
          </p>
        </AnimateIn>

        {/* Articles list — each item animates individually as it enters the viewport */}
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
                    <p className="text-[var(--fg-faint)] text-xs">By {article.author.name}</p>
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
      </div>
    </div>
  )
}
