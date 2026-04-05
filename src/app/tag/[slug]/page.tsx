import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const tag = await prisma.tag.findUnique({ where: { slug } }).catch(() => null)
  if (!tag) return {}
  return {
    title: `${tag.name} | The Consilium`,
    description: `All articles tagged with "${tag.name}" in The Consilium.`,
  }
}

export default async function TagPage({ params }: Props) {
  const { slug } = await params

  const tag = await prisma.tag.findUnique({
    where: { slug },
    include: {
      articles: {
        where: { article: { status: 'PUBLISHED' } },
        orderBy: { article: { publishedAt: 'desc' } },
        include: {
          article: {
            include: { author: true, category: true },
          },
        },
      },
    },
  }).catch(() => null)

  if (!tag) notFound()

  const articles = tag.articles.map((at) => at.article)

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <div className="bg-navy border-b-2 border-gold py-14 px-4 text-center">
        <p className="text-gold/60 text-[0.65rem] font-bold uppercase tracking-[0.3em] mb-3">Topic</p>
        <h1
          className="text-3xl sm:text-4xl font-bold text-cream mb-2"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {tag.name}
        </h1>
        <p className="text-cream/40 text-xs uppercase tracking-widest">
          {articles.length} article{articles.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {articles.length === 0 ? (
          <p className="text-center text-[var(--fg-faint)] text-sm py-20">No published articles yet.</p>
        ) : (
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {articles.map((article) => (
              <StaggerItem key={article.id}>
                <article className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden group card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
                  <div className="relative h-44 bg-navy/10 overflow-hidden img-zoom flex-shrink-0">
                    {article.coverImage ? (
                      <Image src={article.coverImage} alt={article.title} fill className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                        <span className="text-gold/15 text-3xl font-bold" style={{ fontFamily: 'var(--font-serif)' }}>TC</span>
                      </div>
                    )}
                    {article.category && (
                      <div className="absolute top-3 left-3 z-10">
                        <Link href={`/category/${article.category.slug}`} className="category-badge">
                          {article.category.name}
                        </Link>
                      </div>
                    )}
                  </div>
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
                      <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-3 line-clamp-2">{article.excerpt}</p>
                    )}
                    <div className="flex items-center justify-between text-[0.7rem] text-[var(--fg-faint)] border-t border-[var(--border)] pt-3 mt-auto">
                      <Link
                        href={`/author/${article.author.slug ?? article.author.id}`}
                        className="hover:text-gold transition-colors font-semibold text-[var(--fg-muted)]"
                      >
                        {article.author.name}
                      </Link>
                      <span>{article.publishedAt ? format(new Date(article.publishedAt), 'd MMM yyyy') : ''}</span>
                    </div>
                  </div>
                </article>
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </div>
    </div>
  )
}
