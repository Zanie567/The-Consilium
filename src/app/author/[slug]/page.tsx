import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ category?: string }>
}

async function getAuthor(slug: string) {
  try {
    // Try by stored slug first, then fall back to name-derived lookup
    const bySlug = await prisma.user.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true, email: true, bio: true, image: true, role: true,
      },
    })
    if (bySlug) return bySlug

    // Fallback: match by ID (for authors without slugs set yet)
    return await prisma.user.findUnique({
      where: { id: slug },
      select: {
        id: true, name: true, slug: true, email: true, bio: true, image: true, role: true,
      },
    })
  } catch { return null }
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN:  'Editor-in-Chief',
  EDITOR: 'Editor',
  WRITER: 'Writer',
  READER: 'Contributor',
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const author = await getAuthor(slug)
  if (!author) return {}
  return {
    title: author.name ?? 'Author',
    description: author.bio ?? `Articles by ${author.name ?? 'this author'} in The Consilium.`,
  }
}

export default async function AuthorPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { category: categoryFilter } = await searchParams

  const author = await getAuthor(slug)
  if (!author) notFound()

  const articles = await prisma.article.findMany({
    where: {
      authorId: author.id,
      status: 'PUBLISHED',
      ...(categoryFilter ? { category: { slug: categoryFilter } } : {}),
    },
    orderBy: { publishedAt: 'desc' },
    include: { category: true },
  }).catch(() => [])

  // All categories this author has written in
  const allCategories = await prisma.category.findMany({
    where: {
      articles: { some: { authorId: author.id, status: 'PUBLISHED' } },
    },
    orderBy: { name: 'asc' },
  }).catch(() => [])

  const authorSlug = author.slug ?? author.id

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Profile header */}
      <div className="bg-navy border-b-2 border-gold py-16 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center sm:items-start gap-8">
          {/* Avatar */}
          <div className="shrink-0">
            {author.image ? (
              <Image
                src={author.image}
                alt={author.name ?? ''}
                width={100}
                height={100}
                className="rounded-full object-cover ring-2 ring-gold/40"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gold/20 flex items-center justify-center ring-2 ring-gold/40">
                <span
                  className="text-gold text-4xl font-bold"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {author.name?.charAt(0) ?? '?'}
                </span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left">
            <p className="text-gold/60 text-[0.65rem] font-bold uppercase tracking-[0.3em] mb-2">
              {ROLE_LABEL[author.role] ?? 'Contributor'}
            </p>
            <h1
              className="text-3xl sm:text-4xl font-bold text-cream mb-3 leading-tight"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {author.name}
            </h1>
            {author.bio && (
              <p className="text-cream/65 text-base leading-relaxed max-w-xl">
                {author.bio}
              </p>
            )}
            <p className="text-gold/40 text-xs mt-4 font-semibold uppercase tracking-widest">
              {articles.length} published article{articles.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Category filter */}
        {allCategories.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-10">
            <Link
              href={`/author/${authorSlug}`}
              className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors duration-200 ${
                !categoryFilter
                  ? 'bg-navy text-gold'
                  : 'border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold'
              }`}
            >
              All
            </Link>
            {allCategories.map((cat) => (
              <Link
                key={cat.id}
                href={`/author/${authorSlug}?category=${cat.slug}`}
                className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors duration-200 ${
                  categoryFilter === cat.slug
                    ? 'bg-navy text-gold'
                    : 'border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold'
                }`}
              >
                {cat.name}
              </Link>
            ))}
          </div>
        )}

        {articles.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-[var(--fg-faint)] text-sm">
              {categoryFilter ? 'No articles in this category.' : 'No published articles yet.'}
            </p>
          </div>
        ) : (
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {articles.map((article) => (
              <StaggerItem key={article.id}>
                <Link href={`/articles/${article.slug}`} className="block h-full group">
                  <article className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
                    <div className="relative h-44 bg-navy/10 overflow-hidden img-zoom flex-shrink-0">
                      {article.coverImage ? (
                        <Image src={article.coverImage} alt={article.title} fill className="object-cover" />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                          <span className="text-gold/15 text-3xl font-bold select-none" style={{ fontFamily: 'var(--font-serif)' }}>TC</span>
                        </div>
                      )}
                      {article.category && (
                        <div className="absolute top-3 left-3 z-10">
                          <span className="category-badge">{article.category.name}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-5 flex flex-col flex-1">
                      <h3
                        className="text-base font-bold text-[var(--fg)] mb-2 leading-snug group-hover:text-gold transition-colors duration-200 line-clamp-2 flex-1"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {article.title}
                      </h3>
                      {article.excerpt && (
                        <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-3 line-clamp-2">
                          {article.excerpt}
                        </p>
                      )}
                      <p className="text-[0.7rem] text-[var(--fg-faint)] mt-auto pt-3 border-t border-[var(--border)]">
                        {article.publishedAt ? format(new Date(article.publishedAt), 'd MMMM yyyy') : ''}
                      </p>
                    </div>
                  </article>
                </Link>
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </div>
    </div>
  )
}
