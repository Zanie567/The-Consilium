import Link from 'next/link'
import { format } from 'date-fns'
import { Clock } from 'lucide-react'
import { BlurImage } from '@/components/ui/BlurImage'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { readTimeLabel } from '@/lib/readTime'
import { displayAuthorName } from '@/lib/authorUtils'

interface ArticleBase {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  coverImage: string | null
  publishedAt: Date | string | null
  author: { name: string | null }
  category: { name: string; slug: string } | null
}

interface HeroSectionProps {
  featured: ArticleBase
  sideArticles: ArticleBase[]
}

export function HeroSection({ featured, sideArticles }: HeroSectionProps) {
  const three = sideArticles.slice(0, 3)

  return (
    <AnimateIn variant="fade-up" duration={0.6}>
      <section className="py-4 lg:py-6 border-b border-[var(--border)]">
        {/* Width matches navbar: full-width with same horizontal padding */}
        <div className="w-full pl-3 pr-4 sm:pl-5 sm:pr-6 lg:pl-7 lg:pr-8">

          {/* Desktop: left 2/3 featured + right 1/3 three cards */}
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">

            {/* ── Featured article (2/3 width on lg+) ── */}
            <Link
              href={`/articles/${featured.slug}`}
              className="block lg:w-2/3 border-r-0 lg:border-r border-gray-200 dark:border-gray-700 group bg-[var(--bg-elevated)] flex-shrink-0"
              aria-label={`Featured: ${featured.title}`}
            >
              {/* Cover image: viewport-relative height so it never pushes below the fold */}
              <div className="relative w-full overflow-hidden bg-navy h-[38vh] min-h-[220px] max-h-[400px]">
                {featured.coverImage ? (
                  <BlurImage
                    src={featured.coverImage}
                    alt={featured.title}
                    fill
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                    priority
                    sizes="(max-width: 1024px) 100vw, 66vw"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-navy via-navy to-[#0f1a33] flex items-center justify-center">
                    <span
                      className="text-gold/10 text-9xl font-bold select-none"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      TC
                    </span>
                  </div>
                )}
              </div>

              {/* Text block */}
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-2">
                  {featured.category && (
                    <span className="category-badge">{featured.category.name}</span>
                  )}
                  <span className="flex items-center gap-1 text-[var(--fg-faint)] text-[10px] font-semibold leading-none">
                    <Clock size={9} className="shrink-0" />
                    {readTimeLabel(featured.content)}
                  </span>
                </div>

                <p className="text-gold/70 text-[0.6rem] tracking-[0.25em] uppercase font-bold mb-1.5">
                  Featured
                </p>
                <h2
                  className="text-xl sm:text-2xl lg:text-3xl font-bold text-[var(--fg)] leading-tight mb-2 group-hover:text-gold transition-colors duration-200 line-clamp-2"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {featured.title}
                </h2>
                <div className="flex items-center gap-2 text-[var(--fg-faint)] text-xs">
                  <span className="font-semibold text-[var(--fg-muted)]">
                    {displayAuthorName(featured.author.name)}
                  </span>
                  {featured.publishedAt && (
                    <>
                      <span className="text-gold/40">·</span>
                      <span>{format(new Date(featured.publishedAt), 'd MMM yyyy')}</span>
                    </>
                  )}
                </div>
              </div>
            </Link>

            {/* ── Side cards (1/3 width on lg+): each card is individually bordered ── */}
            <div className="lg:w-1/3 flex flex-col gap-2.5">
              {three.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-8 border border-gray-200 dark:border-gray-700 rounded-sm bg-[var(--bg-elevated)]">
                  <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest">
                    More stories soon
                  </p>
                </div>
              ) : (
                three.map((article) => (
                  <Link
                    key={article.id}
                    href={`/articles/${article.slug}`}
                    className="flex gap-3 group border border-gray-200 dark:border-gray-700 rounded-sm p-2.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] transition-colors duration-150"
                  >
                    {/* Thumbnail */}
                    <div className="relative w-16 sm:w-20 flex-shrink-0 bg-navy/10 overflow-hidden rounded-sm self-start" style={{ aspectRatio: '4 / 3' }}>
                      {article.coverImage ? (
                        <BlurImage
                          src={article.coverImage}
                          alt={article.title}
                          fill
                          className="object-cover object-center transition-transform duration-300 group-hover:scale-[1.04]"
                          sizes="80px"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                          <span
                            className="text-gold/20 text-lg font-bold select-none"
                            style={{ fontFamily: 'var(--font-serif)' }}
                          >
                            TC
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex flex-col flex-1 min-w-0">
                      {article.category && (
                        <span className="text-gold text-[0.6rem] font-bold tracking-[0.15em] uppercase mb-1 truncate">
                          {article.category.name}
                        </span>
                      )}
                      <h3
                        className="text-xs font-semibold text-[var(--fg)] leading-snug group-hover:text-gold transition-colors duration-150 line-clamp-2 flex-1"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {article.title}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[var(--fg-faint)] text-[0.6rem] mt-1.5">
                        <span className="truncate">{displayAuthorName(article.author.name)}</span>
                        {article.publishedAt && (
                          <>
                            <span className="text-[var(--border)]">·</span>
                            <span className="shrink-0">{format(new Date(article.publishedAt), 'd MMM')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

        </div>
      </section>
    </AnimateIn>
  )
}
