import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import type { Metadata } from 'next'

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
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">Browse</p>
        <h1
          className="text-4xl sm:text-5xl font-bold text-gold"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Archive
        </h1>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Search + Filter */}
        <form method="GET" className="flex flex-col sm:flex-row gap-3 mb-10">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search articles..."
            className="flex-1 border border-navy/20 px-4 py-2.5 text-navy text-sm focus:outline-none focus:border-gold bg-white"
          />
          <select
            name="category"
            defaultValue={categorySlug ?? ''}
            className="border border-navy/20 px-4 py-2.5 text-navy text-sm focus:outline-none focus:border-gold bg-white"
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

        {/* Results count */}
        <p className="text-navy/40 text-xs uppercase tracking-widest mb-6">
          {articles.length} article{articles.length !== 1 ? 's' : ''}{' '}
          {q ? `matching "${q}"` : 'published'}
        </p>

        {/* Articles list */}
        {articles.length > 0 ? (
          <div className="divide-y divide-gold/15">
            {articles.map((article) => (
              <article
                key={article.id}
                className="py-6 flex flex-col sm:flex-row sm:items-start gap-4 group"
              >
                <div className="sm:w-32 shrink-0 text-xs text-navy/40 pt-1">
                  {article.publishedAt
                    ? format(new Date(article.publishedAt), 'd MMM yyyy')
                    : '—'}
                </div>
                <div className="flex-1">
                  {article.category && (
                    <span className="category-badge mb-2 inline-block">
                      {article.category.name}
                    </span>
                  )}
                  <Link href={`/articles/${article.slug}`}>
                    <h3
                      className="text-lg font-bold text-navy group-hover:text-gold transition-colors leading-snug mb-1"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {article.title}
                    </h3>
                  </Link>
                  {article.excerpt && (
                    <p className="text-navy/55 text-sm leading-relaxed mb-2 line-clamp-2">
                      {article.excerpt}
                    </p>
                  )}
                  <p className="text-navy/40 text-xs">By {article.author.name}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-navy/30 text-sm uppercase tracking-widest">
              No articles found
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
