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
}

export function HeroSection({ featured }: HeroSectionProps) {
  return (
    <AnimateIn variant="fade-up" duration={0.6} className="mb-14">
      <div className="overflow-hidden group card-hover transition-[transform,box-shadow] duration-150 ease-out">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Image */}
          <div className="relative h-64 lg:h-auto lg:min-h-[400px] bg-navy-light overflow-hidden">
            {featured.coverImage ? (
              <BlurImage
                src={featured.coverImage}
                alt={featured.title}
                fill
                className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05]"
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-navy via-navy-light to-navy flex items-center justify-center">
                <span
                  className="text-gold/15 text-8xl font-bold select-none"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  TC
                </span>
              </div>
            )}
            {/* Top row: category badge + read time */}
            <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between">
              {featured.category ? (
                <span className="category-badge">{featured.category.name}</span>
              ) : (
                <span aria-hidden="true" />
              )}
              <span className="flex items-center gap-1 bg-navy/70 text-cream/90 text-[10px] font-semibold px-2 py-1 backdrop-blur-sm leading-none">
                <Clock size={9} className="shrink-0" />
                {readTimeLabel(featured.content)}
              </span>
            </div>
            {/* Gradient overlay bottom */}
            <div className="absolute inset-0 bg-gradient-to-t from-navy/30 via-transparent to-transparent pointer-events-none" />
          </div>

          {/* Content */}
          <div className="p-8 lg:p-12 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-[var(--border)]">
            <div className="text-gold/50 text-[0.65rem] tracking-[0.3em] uppercase mb-3 font-semibold">
              Featured
            </div>
            <Link href={`/articles/${featured.slug}`}>
              <h2
                className="text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4 leading-tight transition-colors duration-200 hover:text-gold"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {featured.title}
              </h2>
            </Link>
            {featured.excerpt && (
              <p className="text-[var(--fg-muted)] text-base leading-relaxed mb-6">
                {featured.excerpt}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-[var(--fg-faint)] mb-7">
              <span className="font-semibold text-[var(--fg-muted)]">
                {displayAuthorName(featured.author.name)}
              </span>
              <span className="text-gold/40">·</span>
              <span>
                {featured.publishedAt
                  ? format(new Date(featured.publishedAt), 'd MMMM yyyy')
                  : ''}
              </span>
            </div>
            <Link
              href={`/articles/${featured.slug}`}
              className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest group/link hover:gap-3 transition-[gap] duration-200 ease-out"
            >
              Read Article
              <span className="inline-block transition-transform duration-200 ease-out group-hover/link:translate-x-1">
                →
              </span>
            </Link>
          </div>
        </div>
      </div>
    </AnimateIn>
  )
}
