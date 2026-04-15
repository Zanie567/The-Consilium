import Link from 'next/link'
import { format } from 'date-fns'
import { Clock } from 'lucide-react'
import { BlurImage } from '@/components/ui/BlurImage'
import { BookmarkButton } from '@/components/ui/BookmarkButton'
import { readTimeLabel } from '@/lib/readTime'

interface Article {
  id: string
  slug: string
  title: string
  excerpt: string | null
  coverImage: string | null
  content: string
  publishedAt: Date | string | null
  author: { name: string | null }
  category: { name: string; slug: string } | null
}

interface ArticleCardProps {
  article: Article
  /** Override the category badge label (e.g. on category pages where the category is already known) */
  badgeLabel?: string
}

export function ArticleCard({ article, badgeLabel }: ArticleCardProps) {
  const badge = badgeLabel ?? article.category?.name
  const readTime = readTimeLabel(article.content)

  return (
    <Link href={`/articles/${article.slug}`} className="block h-full group">
      <article className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
        {/* Image */}
        <div className="relative h-48 bg-navy/10 overflow-hidden img-zoom flex-shrink-0">
          {article.coverImage ? (
            <BlurImage
              src={article.coverImage}
              alt={article.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
              <span
                className="text-gold/15 text-4xl font-bold select-none"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                TC
              </span>
            </div>
          )}

          {/* Top overlay row: category badge (left) + read time (right) */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-start justify-between p-3">
            {badge ? (
              <span className="category-badge">{badge}</span>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-1 bg-navy/70 text-cream/90 text-[10px] font-semibold px-2 py-1 backdrop-blur-sm leading-none">
              <Clock size={9} className="shrink-0" />
              {readTime}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col flex-1">
          <h3
            className="text-base font-bold text-[var(--fg)] mb-2 leading-snug group-hover:text-gold transition-colors duration-200 line-clamp-2 flex-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {article.title}
          </h3>
          {article.excerpt && (
            <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-4 line-clamp-2">
              {article.excerpt}
            </p>
          )}
          <div className="flex items-center justify-between text-[0.7rem] text-[var(--fg-faint)] border-t border-[var(--border)] pt-3 mt-auto">
            <span className="font-semibold text-[var(--fg-muted)]">{article.author.name}</span>
            <div className="flex items-center gap-3">
              <span>
                {article.publishedAt
                  ? format(new Date(article.publishedAt), 'd MMM yyyy')
                  : ''}
              </span>
              <BookmarkButton articleId={article.id} />
            </div>
          </div>
        </div>
      </article>
    </Link>
  )
}
