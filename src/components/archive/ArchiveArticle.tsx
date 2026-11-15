import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { CoverImage } from '@/components/ui/CoverImage'
import type { DISCOVERY_ARTICLE_SELECT } from '@/lib/discoveryQueries'
import { archiveDateTimeAttr, formatArchiveDate } from '@/lib/archiveGroups'
import { displayAuthorName } from '@/lib/authorUtils'

export type ArchiveArticleData = Prisma.ArticleGetPayload<{ select: typeof DISCOVERY_ARTICLE_SELECT }>

/** Topics shown on a row; the rest are counted so a heavily tagged article stays one line. */
const MAX_ROW_TOPICS = 3

/**
 * What fills the picture box when an article has no cover (or its cover cannot be shown): the
 * publication's monogram on navy. Never a stock photograph standing in for a real cover.
 */
function CoverPlaceholder({ large = false }: { large?: boolean }) {
  return (
    <div className="archive-placeholder absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <span
        className={`select-none font-bold ${large ? 'text-6xl sm:text-7xl' : 'text-2xl sm:text-4xl'}`}
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        TC
      </span>
    </div>
  )
}

/**
 * Secondary links (format, author, topics) sit above the row's stretched headline link, so each
 * goes where it says while the rest of the row opens the article. They are not prefetched: a
 * page of twenty rows would otherwise start around a hundred background requests.
 */
function Byline({ article, className = '' }: { article: ArchiveArticleData; className?: string }) {
  const topics = article.tags.slice(0, MAX_ROW_TOPICS)
  const hiddenTopics = article.tags.length - topics.length
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.8rem] text-[var(--fg-muted)] ${className}`}>
      <span>
        By{' '}
        <Link
          href={`/author/${article.author.slug ?? article.author.id}`}
          prefetch={false}
          className="archive-sublink relative z-10 font-semibold text-[var(--fg)]"
        >
          {displayAuthorName(article.author.name)}
        </Link>
      </span>
      {topics.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Topics">
          {topics.map(({ tag }) => (
            <li key={tag.id}>
              <Link href={`/tag/${tag.slug}`} prefetch={false} className="archive-topic relative z-10">
                {tag.name}
              </Link>
            </li>
          ))}
          {hiddenTopics > 0 && (
            <li className="text-xs text-[var(--fg-faint)]" aria-label={`and ${hiddenTopics} more`}>
              +{hiddenTopics}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function Kicker({ article }: { article: ArchiveArticleData }) {
  const date = formatArchiveDate(article.publishedAt)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {article.category && (
        <Link href={`/category/${article.category.slug}`} prefetch={false} className="category-badge relative z-10">
          {article.category.name}
        </Link>
      )}
      {date && (
        <time dateTime={archiveDateTimeAttr(article.publishedAt)} className="text-xs tabular-nums text-[var(--fg-muted)]">
          {date}
        </time>
      )}
    </div>
  )
}

/** The newest article, given the top of the first page. */
export function ArchiveLead({ article }: { article: ArchiveArticleData }) {
  return (
    <article className="archive-item group relative grid gap-6 border-b border-[var(--border-strong)] pb-10 lg:grid-cols-12 lg:gap-10 lg:pb-12">
      <div className="archive-cover relative aspect-[3/2] overflow-hidden bg-navy/10 lg:col-span-7 dark:bg-navy/30">
        <CoverImage
          src={article.coverImage}
          alt=""
          eager
          sizes="(min-width: 1280px) 660px, (min-width: 1024px) 56vw, 100vw"
          fallback={<CoverPlaceholder large />}
        />
      </div>
      <div className="flex flex-col justify-center lg:col-span-5">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--fg-muted)]">Latest</p>
        <Kicker article={article} />
        <h2
          className="mt-4 text-balance text-3xl font-bold leading-[1.12] text-[var(--fg)] sm:text-4xl lg:text-[2.6rem]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          <Link href={`/articles/${article.slug}`} className="archive-title">
            {article.title}
          </Link>
        </h2>
        {article.excerpt && (
          <p className="mt-4 line-clamp-4 max-w-[60ch] text-base leading-relaxed text-[var(--fg-muted)] sm:text-[1.0625rem]">
            {article.excerpt}
          </p>
        )}
        <Byline article={article} className="mt-6" />
      </div>
    </article>
  )
}

/** One archive entry: picture, format and date, headline, standfirst, author and topics. */
export function ArchiveRow({ article, eager = false }: { article: ArchiveArticleData; eager?: boolean }) {
  return (
    <article className="archive-item group relative grid grid-cols-[minmax(0,1fr)_6.75rem] gap-4 py-6 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:gap-7 sm:py-7 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <div className="archive-cover relative order-2 aspect-[3/2] self-start overflow-hidden bg-navy/10 sm:order-1 dark:bg-navy/30">
        <CoverImage
          src={article.coverImage}
          alt=""
          eager={eager}
          sizes="(min-width: 1024px) 264px, (min-width: 640px) 216px, 108px"
          fallback={<CoverPlaceholder />}
        />
      </div>
      <div className="order-1 min-w-0 sm:order-2">
        <Kicker article={article} />
        <h3
          className="mt-2.5 text-pretty text-[1.2rem] font-bold leading-snug text-[var(--fg)] sm:text-2xl sm:leading-[1.2]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          <Link href={`/articles/${article.slug}`} className="archive-title">
            {article.title}
          </Link>
        </h3>
        {article.excerpt && (
          <p className="mt-2 hidden max-w-[68ch] text-[0.95rem] leading-relaxed text-[var(--fg-muted)] sm:line-clamp-2">
            {article.excerpt}
          </p>
        )}
        <Byline article={article} className="mt-3" />
      </div>
    </article>
  )
}
