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
      <section className="py-8 lg:py-10 border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Desktop: left 2/3 featured + right 1/3 three cards */}
          <div className="flex flex-col lg:flex-row border border-[var(--border)]">

            {/* ── Featured article (2/3 width on lg+) ── */}
            <Link
              href={`/articles/${featured.slug}`}
              className="block lg:w-2/3 border-r-0 lg:border-r border-[var(--border)] group bg-[var(--bg-elevated)] flex-shrink-0"
              aria-label={`Featured: ${featured.title}`}
            >
              {/* Cover image: fixed aspect ratio, no overlay */}
              <div className="relative w-full overflow-hidden bg-navy" style={{ aspectRatio: '16 / 9' }}>
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

              {/* Text block: clean space below image */}
              <div className="p-5 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  {featured.category && (
                    <span className="category-badge">{featured.category.name}</span>
                  )}
                  <span className="flex items-center gap-1 text-[var(--fg-faint)] text-[10px] font-semibold leading-none">
                    <Clock size={9} className="shrink-0" />
                    {readTimeLabel(featured.content)}
                  </span>
                </div>

                <p className="text-gold/70 text-[0.6rem] tracking-[0.25em] uppercase font-bold mb-2">
                  Featured
                </p>
                <h2
                  className="text-xl sm:text-2xl lg:text-3xl font-bold text-[var(--fg)] leading-tight mb-3 group-hover:text-gold transition-colors duration-200 line-clamp-3"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {featured.title}
                </h2>
                {featured.excerpt && (
                  <p className="text-[var(--fg-muted)] text-sm leading-relaxed line-clamp-2 mb-4 hidden sm:block">
                    {featured.excerpt}
                  </p>
                )}
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

            {/* ── Side cards (1/3 width on lg+) ── */}
            <div className="lg:w-1/3 flex flex-col border-t lg:border-t-0 bg-[var(--bg-elevated)]">
              {three.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-8">
                  <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest">
                    More stories soon
                  </p>
                </div>
              ) : (
                three.map((article, index) => (
                  <Link
                    key={article.id}
                    href={`/articles/${article.slug}`}
                    className={`flex gap-4 group hover:bg-[var(--bg-subtle)] transition-colors duration-150 p-4 sm:p-5${index < three.length - 1 ? ' border-b border-gray-100 dark:border-gray-800' : ''}`}
                  >
                    {/* Thumbnail */}
                    <div className="relative w-20 sm:w-24 flex-shrink-0 bg-navy/10 overflow-hidden self-start" style={{ aspectRatio: '4 / 3' }}>
                      {article.coverImage ? (
                        <BlurImage
                          src={article.coverImage}
                          alt={article.title}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                          sizes="96px"
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
                    <div className="flex flex-col justify-between flex-1 min-w-0">
                      {article.category && (
                        <span className="text-gold text-[0.6rem] font-bold tracking-[0.15em] uppercase mb-1 truncate">
                          {article.category.name}
                        </span>
                      )}
                      <h3
                        className="text-sm font-semibold text-[var(--fg)] leading-snug group-hover:text-gold transition-colors duration-150 line-clamp-3 flex-1"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {article.title}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[var(--fg-faint)] text-[0.65rem] mt-2">
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
