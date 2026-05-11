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
      {/* Full-width hero: no max-width, same edge-to-edge boundary as the navbar */}
      <div className="w-full border-b border-[var(--border)]">

        {/* Desktop: left 2/3 featured + right 1/3 three cards */}
        <div className="flex flex-col lg:flex-row">

          {/* ── Featured article (2/3 width on lg+) ── */}
          <Link
            href={`/articles/${featured.slug}`}
            className="block relative lg:w-2/3 bg-navy overflow-hidden group min-h-[420px] lg:min-h-[520px]"
            aria-label={`Featured: ${featured.title}`}
          >
            {/* Cover image */}
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

            {/* Gradient overlay: strong at bottom for text legibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-navy/90 via-navy/25 to-transparent pointer-events-none" />

            {/* Top row: category + read time */}
            <div className="absolute top-5 left-5 right-5 z-10 flex items-start justify-between">
              {featured.category && (
                <span className="category-badge">{featured.category.name}</span>
              )}
              <span className="flex items-center gap-1 bg-navy/75 text-cream/90 text-[10px] font-semibold px-2 py-1 backdrop-blur-sm leading-none">
                <Clock size={9} className="shrink-0" />
                {readTimeLabel(featured.content)}
              </span>
            </div>

            {/* Bottom content overlay */}
            <div className="absolute bottom-0 left-0 right-0 z-10 p-6 lg:p-8">
              <p className="text-gold/70 text-[0.6rem] tracking-[0.25em] uppercase font-bold mb-2">
                Featured
              </p>
              <h2
                className="text-2xl lg:text-3xl xl:text-4xl font-bold text-cream leading-tight mb-3 group-hover:text-gold transition-colors duration-200 line-clamp-3"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {featured.title}
              </h2>
              {featured.excerpt && (
                <p className="text-cream/65 text-sm leading-relaxed line-clamp-2 mb-4 hidden sm:block">
                  {featured.excerpt}
                </p>
              )}
              <div className="flex items-center gap-2 text-cream/50 text-xs">
                <span className="font-semibold text-cream/70">
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
          <div className="lg:w-1/3 flex flex-col divide-y divide-[var(--border)] border-t lg:border-t-0 lg:border-l border-[var(--border)] bg-[var(--bg-elevated)]">
            {three.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest">
                  More stories soon
                </p>
              </div>
            ) : (
              three.map((article) => (
                <Link
                  key={article.id}
                  href={`/articles/${article.slug}`}
                  className="flex gap-0 group flex-1 hover:bg-[var(--bg-subtle)] transition-colors duration-150 min-h-[120px] lg:min-h-0"
                >
                  {/* Thumbnail */}
                  <div className="relative w-24 sm:w-28 lg:w-24 xl:w-32 flex-shrink-0 bg-navy/10 overflow-hidden">
                    {article.coverImage ? (
                      <BlurImage
                        src={article.coverImage}
                        alt={article.title}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        sizes="(max-width: 1024px) 112px, 128px"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                        <span
                          className="text-gold/20 text-2xl font-bold select-none"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          TC
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex flex-col justify-between p-3 sm:p-4 flex-1 min-w-0">
                    {article.category && (
                      <span className="text-gold/70 text-[0.6rem] font-bold tracking-[0.15em] uppercase mb-1 truncate">
                        {article.category.name}
                      </span>
                    )}
                    <h3
                      className="text-sm font-bold text-[var(--fg)] leading-snug group-hover:text-gold transition-colors duration-150 line-clamp-3 flex-1"
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
    </AnimateIn>
  )
}
