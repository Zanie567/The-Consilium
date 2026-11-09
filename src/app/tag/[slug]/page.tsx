import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { getPublicTag } from '@/lib/publicPageData'
import { format } from 'date-fns'
import { StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { ArticleEmptyState } from '@/components/ui/ArticleEmptyState'
import { getTagEmptyState } from '@/lib/sectionEmptyStates'
import type { Metadata } from 'next'
import { canonicalAlternates } from '@/lib/seo'

interface Props {
  params: Promise<{ slug: string }>
}

// Served from the CDN (ISR): rendered on the first request for a slug, then cached for
// PUBLIC_PAGE_REVALIDATE_SECONDS (literal below) and expired at once by revalidateArticleLists()
// whenever anything public changes. Nothing on this page may read the session, cookies, headers or
// searchParams, which would make it per-request again. A failed database read throws, so it is never
// cached: the first render shows the retryable error page, and a failed background refresh keeps
// serving the last good copy. An unknown slug's 404 is cached too, and is expired the same way when
// the slug is published. Pinned by tests/unit/public-page-caching.test.ts.
export const revalidate = 3600
export function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const tag = await getPublicTag(slug)
  if (!tag) return {}
  return {
    title: tag.name,
    description: `All articles tagged with "${tag.name}" in The Consilium.`,
    alternates: canonicalAlternates(`/tag/${tag.slug}`),
  }
}

export default async function TagPage({ params }: Props) {
  const { slug } = await params

  // A failed read throws (retryable error page); only a successful null is a 404.
  const tag = await getPublicTag(slug)

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
        <Link href={`/archive?tag=${encodeURIComponent(tag.slug)}`} className="inline-block underline mb-6">Browse all {tag.name} articles and filter by format</Link>
        {articles.length === 0 ? (
          <ArticleEmptyState
            state={getTagEmptyState(tag.name)}
            action={{ href: '/archive', label: '← Browse the Archive' }}
          />
        ) : (
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {articles.map((article) => (
              <StaggerItem key={article.id}>
                <article className="relative bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden group card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
                  <Link href={`/articles/${article.slug}`} className="absolute inset-0 z-0" aria-label={article.title} />
                  <div className="pointer-events-none relative h-44 bg-navy/10 overflow-hidden img-zoom flex-shrink-0">
                    {article.coverImage ? (
                      <Image src={article.coverImage} alt={article.title} fill className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                        <span className="text-gold/15 text-3xl font-bold" style={{ fontFamily: 'var(--font-serif)' }}>TC</span>
                      </div>
                    )}
                    {article.category && (
                      <div className="absolute top-3 left-3 z-10">
                        <Link href={`/category/${article.category.slug}`} className="pointer-events-auto category-badge relative z-10">
                          {article.category.name}
                        </Link>
                      </div>
                    )}
                  </div>
                  <div className="pointer-events-none relative z-10 p-5 flex flex-col flex-1">
                    <h3
                      className="text-base font-bold text-[var(--fg)] mb-2 leading-snug group-hover:text-gold transition-colors duration-200 line-clamp-2 flex-1"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {article.title}
                    </h3>
                    {article.excerpt && (
                      <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-3 line-clamp-2">{article.excerpt}</p>
                    )}
                    <div className="flex items-center justify-between text-[0.7rem] text-[var(--fg-faint)] border-t border-[var(--border)] pt-3 mt-auto">
                      <Link
                        href={`/author/${article.author.slug ?? article.author.id}`}
                        className="pointer-events-auto relative z-10 hover:text-gold transition-colors font-semibold text-[var(--fg-muted)]"
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
