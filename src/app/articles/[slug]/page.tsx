import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { format } from 'date-fns'
import { Clock } from 'lucide-react'
import { ShareButtons } from '@/components/ui/ShareButtons'
import { BookmarkButton } from '@/components/ui/BookmarkButton'
import { ReadingTracker } from '@/components/ui/ReadingTracker'
import { ReadingProgress } from '@/components/ui/ReadingProgress'
import { ArticleAnchorLinks } from '@/components/ui/ArticleAnchorLinks'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { ViewCounter } from '@/components/ui/ViewCounter'
import { PrintButton } from '@/components/ui/PrintButton'
import { SaveAsPdfButton } from '@/components/ui/SaveAsPdfButton'
import { BlurImage } from '@/components/ui/BlurImage'
import { CommentSection } from '@/components/ui/CommentSection'
import { readTimeLabel } from '@/lib/readTime'
import { getInitials, displayAuthorName } from '@/lib/authorUtils'
import type { Metadata } from 'next'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/constants'

interface Props {
  params: Promise<{ slug: string }>
}

async function getArticle(slug: string) {
  try {
    return await prisma.article.findUnique({
      where: { slug, status: 'PUBLISHED', deletedAt: null },
      include: {
        author: true,
        category: true,
        tags: { include: { tag: true } },
        series: {
          include: {
            articles: {
              where: { status: 'PUBLISHED', deletedAt: null },
              select: { id: true, title: true, slug: true, seriesOrder: true },
              orderBy: { seriesOrder: 'asc' },
            },
          },
        },
      },
    })
  } catch { return null }
}

function getArticleUrl(slug: string): string {
  return `${SITE_URL.replace(/\/$/, '')}/articles/${slug}`
}

// ── Relevance-scored related articles ────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','as','is','was','are','were','be','been','have','has','had','do','does',
  'did','will','would','could','should','that','this','these','those','it','its',
  'not','more','also','than','into','their','there','which','when','how','why',
])

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  )
}

async function getRelatedArticles(
  currentId: string,
  categoryId: string | null | undefined,
  title: string,
  excerpt: string | null
) {
  try {
    const candidates = await prisma.article.findMany({
      where: { status: 'PUBLISHED', id: { not: currentId }, deletedAt: null },
      take: 40,
      orderBy: { publishedAt: 'desc' },
      include: { author: true, category: true },
    })

    const sourceWords = extractKeywords(`${title} ${excerpt ?? ''}`)
    const now = Date.now()

    const scored = candidates.map((c) => {
      let score = 0

      // Category match - highest weight
      if (categoryId && c.categoryId === categoryId) score += 10

      // Keyword overlap between titles and excerpts
      const candidateWords = extractKeywords(`${c.title} ${c.excerpt ?? ''}`)
      for (const word of candidateWords) {
        if (sourceWords.has(word)) score += 1.5
      }

      // Recency bonus
      if (c.publishedAt) {
        const daysSince = (now - c.publishedAt.getTime()) / 86_400_000
        if (daysSince < 14) score += 3
        else if (daysSince < 60) score += 1.5
        else if (daysSince < 180) score += 0.5
      }

      return { article: c, score }
    })

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.article)
  } catch { return [] }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticle(slug)
  if (!article) return {}
  const articleUrl = getArticleUrl(article.slug)

  return {
    title: {
      absolute: `${article.title} | ${SITE_NAME}`,
    },
    description: article.excerpt ?? SITE_DESCRIPTION,
    authors: article.author.name ? [{ name: article.author.name }] : undefined,
    openGraph: {
      title: article.title,
      description: article.excerpt ?? undefined,
      type: 'article',
      url: articleUrl,
      publishedTime: article.publishedAt?.toISOString(),
      authors: article.author.name ? [article.author.name] : undefined,
      images: article.coverImage
        ? [{ url: article.coverImage }]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.excerpt ?? undefined,
    },
  }
}

// ── Content rendering ────────────────────────────────────────────────────────

interface TiptapMark {
  type: string
  attrs?: Record<string, string | number | boolean | null>
}

interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
  attrs?: Record<string, string | number | boolean | null>
}

function nodeToHtml(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph': {
      const inner = node.content?.map(nodeToHtml).join('') ?? ''
      if (!inner.trim()) return ''
      return `<p>${inner}</p>`
    }
    case 'heading': {
      const level = (node.attrs?.level as number) ?? 2
      return `<h${level}>${node.content?.map(nodeToHtml).join('') ?? ''}</h${level}>`
    }
    case 'text': {
      let text = node.text ?? ''
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'bold')      text = `<strong>${text}</strong>`
          if (mark.type === 'italic')    text = `<em>${text}</em>`
          if (mark.type === 'underline') text = `<u>${text}</u>`
          if (mark.type === 'highlight') text = `<mark>${text}</mark>`
          if (mark.type === 'link')
            text = `<a href="${mark.attrs?.href ?? '#'}" target="${mark.attrs?.target ?? '_self'}" rel="noopener">${text}</a>`
        }
      }
      return text
    }
    case 'bulletList':    return `<ul>${node.content?.map(nodeToHtml).join('') ?? ''}</ul>`
    case 'orderedList':   return `<ol>${node.content?.map(nodeToHtml).join('') ?? ''}</ol>`
    case 'listItem':      return `<li>${node.content?.map(nodeToHtml).join('') ?? ''}</li>`
    case 'blockquote':    return `<blockquote>${node.content?.map(nodeToHtml).join('') ?? ''}</blockquote>`
    case 'horizontalRule': return `<hr />`
    case 'image':
      // Legacy plain image nodes (new content uses 'figure')
      return `<figure class="article-figure"><img src="${node.attrs?.src ?? ''}" alt="${node.attrs?.alt ?? ''}" /></figure>`
    case 'figure': {
      const src = String(node.attrs?.src ?? '')
      const alt = String(node.attrs?.alt ?? '')
      const caption = String(node.attrs?.caption ?? '')
      const credit = String(node.attrs?.credit ?? '')
      let html = `<figure class="article-figure"><img src="${src}" alt="${alt}" />`
      if (caption) html += `<figcaption class="caption">${caption}</figcaption>`
      if (credit) html += `<p class="image-credit">${credit}</p>`
      html += `</figure>`
      return html
    }
    case 'hardBreak': return `<br />`
    case 'pullQuote':
      return `<aside data-type="pull-quote" class="pull-quote">${node.content?.map(nodeToHtml).join('') ?? ''}</aside>`
    case 'footnoteRef':
      return `<sup class="footnote-ref" data-footnote="${encodeURIComponent(String(node.attrs?.content ?? ''))}" data-index="${node.attrs?.index ?? ''}" title="${node.attrs?.content ?? ''}">[${node.attrs?.index ?? ''}]</sup>`
    // chartNode: silently drop - data callout has been removed
    case 'chartNode':
      return ''
    default:
      return node.content?.map(nodeToHtml).join('') ?? ''
  }
}

function collectFootnotes(doc: { content?: TiptapNode[] }): { index: number; content: string }[] {
  const footnotes: { index: number; content: string }[] = []
  const traverse = (nodes: TiptapNode[] = []) => {
    for (const n of nodes) {
      if (n.type === 'footnoteRef' && n.attrs?.content) {
        footnotes.push({ index: Number(n.attrs.index), content: String(n.attrs.content) })
      }
      if (n.content) traverse(n.content)
    }
  }
  traverse(doc.content)
  return footnotes.sort((a, b) => a.index - b.index)
}

function renderContent(content: string): { html: string; footnotes: { index: number; content: string }[] } {
  try {
    const parsed = JSON.parse(content)
    if (parsed?.type === 'doc') {
      const html = (parsed.content ?? []).map(nodeToHtml).join('')
      const footnotes = collectFootnotes(parsed)
      return { html, footnotes }
    }
  } catch {}
  return { html: content, footnotes: [] }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const [article, session] = await Promise.all([
    getArticle(slug),
    getServerSession(authOptions),
  ])

  if (!article) notFound()

  const currentUser = session?.user
    ? { id: session.user.id, name: session.user.name, role: session.user.role }
    : null

  const related = await getRelatedArticles(
    article.id,
    article.categoryId,
    article.title,
    article.excerpt,
  )
  const { html: htmlContent, footnotes } = renderContent(article.content)

  // Series info
  const seriesArticles = article.series?.articles ?? []
  const seriesPosition = seriesArticles.findIndex((a) => a.id === article.id)
  const prevInSeries = seriesPosition > 0 ? seriesArticles[seriesPosition - 1] : null
  const nextInSeries = seriesPosition < seriesArticles.length - 1 ? seriesArticles[seriesPosition + 1] : null

  const authorHref = `/author/${article.author.slug ?? article.author.id}`
  const articleUrl = getArticleUrl(article.slug)
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt ?? '',
    image: article.coverImage ?? undefined,
    author: {
      '@type': 'Person',
      name: article.author.name ?? SITE_NAME,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
    datePublished: article.publishedAt?.toISOString() ?? '',
    dateModified: article.updatedAt.toISOString(),
    url: articleUrl,
    mainEntityOfPage: articleUrl,
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <ReadingProgress />
      <ReadingTracker articleId={article.id} />
      <ViewCounter articleId={article.id} />

      {/* Print masthead - hidden on screen, shown when printing */}
      <div className="print-masthead hidden">
        <div className="print-masthead-title">The Consilium</div>
        <div className="print-masthead-sub">University of Edinburgh Economics Society</div>
      </div>

      {/* Cover Image */}
      {article.coverImage && (
        <div className="relative h-[260px] md:h-[480px] w-full overflow-hidden no-print">
          <BlurImage
            src={article.coverImage}
            alt={article.title}
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
          {/* Read time badge - top right of hero */}
          <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 bg-navy/70 text-cream/90 text-xs font-semibold px-3 py-1.5 backdrop-blur-sm no-print">
            <Clock size={11} className="shrink-0" />
            {readTimeLabel(article.content)}
          </div>
        </div>
      )}

      <div className="max-w-[680px] mx-auto px-6 sm:px-8 lg:px-12 py-12 print-article-wrapper">

        {/* Correction banner - above everything */}
        {article.corrected && (
          <AnimateIn variant="fade-in" duration={0.4}>
            <div className="correction-notice mb-8 flex items-start gap-3">
              <span className="text-gold font-bold text-sm shrink-0 mt-px">Correction</span>
              <span>
                This article has been updated since its original publication.{' '}
                <a href="#correction-note" className="text-gold underline underline-offset-2 hover:no-underline font-semibold">
                  See the correction note below.
                </a>
              </span>
            </div>
          </AnimateIn>
        )}

        {/* Category */}
        {article.category && (
          <AnimateIn variant="fade-in" duration={0.4}>
            <Link
              href={`/category/${article.category.slug}`}
              className="inline-block category-badge mb-7 hover:opacity-80 transition-opacity no-print"
            >
              {article.category.name}
            </Link>
          </AnimateIn>
        )}

        {/* Series badge */}
        {article.series && (
          <AnimateIn variant="fade-in" duration={0.4}>
            <div className="series-nav mb-6 no-print">
              <p className="text-xs font-bold text-gold uppercase tracking-widest mb-1">
                Series: {article.series.title}
              </p>
              <p className="text-[var(--fg-faint)] text-xs">
                Part {(article.seriesOrder ?? seriesPosition + 1)} of {seriesArticles.length}
              </p>
            </div>
          </AnimateIn>
        )}

        {/* Title */}
        <AnimateIn variant="fade-up" delay={0.05} duration={0.6}>
          <h1
            className="font-bold text-[var(--fg)] leading-tight mb-6 tracking-tight"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'clamp(2rem, 4vw, 3.25rem)',
              fontWeight: 800,
            }}
          >
            {article.title}
          </h1>
        </AnimateIn>

        {/* Excerpt */}
        {article.excerpt && (
          <AnimateIn variant="fade-up" delay={0.1} duration={0.55}>
            <p className="text-[var(--fg-muted)] text-lg sm:text-xl leading-relaxed mb-8 border-l-[3px] border-gold pl-5 italic">
              {article.excerpt}
            </p>
          </AnimateIn>
        )}

        {/* Author + Date + Share + Print */}
        <AnimateIn variant="fade-up" delay={0.15} duration={0.5}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-7 border-b border-[var(--border)] mb-12">
            <div className="flex items-center gap-4">
              <Link href={authorHref} className="shrink-0">
                {article.author.image ? (
                  <Image
                    src={article.author.image}
                    alt={article.author.name ?? ''}
                    width={44}
                    height={44}
                    className="rounded-full object-cover ring-2 ring-gold/20 hover:ring-gold/50 transition-all"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-navy flex items-center justify-center text-gold font-bold text-base ring-2 ring-gold/20 hover:ring-gold/50 transition-all">
                    {getInitials(article.author.name)}
                  </div>
                )}
              </Link>
              <div>
                <Link
                  href={authorHref}
                  className="text-[var(--fg)] font-semibold text-sm hover:text-gold transition-colors"
                >
                  {displayAuthorName(article.author.name)}
                </Link>
                <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                  {article.publishedAt ? format(new Date(article.publishedAt), 'd MMMM yyyy') : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 no-print">
              <PrintButton />
              <SaveAsPdfButton title={article.title} />
              <ShareButtons title={article.title} />
              <BookmarkButton articleId={article.id} />
            </div>
          </div>
        </AnimateIn>

        {/* Article content */}
        <AnimateIn variant="fade-up" delay={0.2} duration={0.6}>
          <div
            id="article-body"
            className="prose-consilium"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
          <ArticleAnchorLinks containerSelector="#article-body" />
        </AnimateIn>

        {/* Tags */}
        {article.tags.length > 0 && (
          <div className="mt-8 pt-6 border-t border-[var(--border)] flex flex-wrap gap-2 items-center">
            <span className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mr-1">Topics</span>
            {article.tags.map(({ tag }) => (
              <Link
                key={tag.id}
                href={`/tag/${tag.slug}`}
                className="text-xs font-semibold px-3 py-1 border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors duration-200"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        )}

        {/* Footnotes */}
        {footnotes.length > 0 && (
          <AnimateIn variant="fade-up" delay={0.05} className="mt-4">
            <div className="footnotes-section">
              <h4>References</h4>
              <ol>
                {footnotes.map((fn) => (
                  <li key={fn.index}>{fn.content}</li>
                ))}
              </ol>
            </div>
          </AnimateIn>
        )}

        {/* Correction note - at bottom of article */}
        {article.corrected && article.correctionNote && (
          <AnimateIn variant="fade-up" delay={0.05} className="mt-10">
            <div id="correction-note" className="border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-5">
              <p className="text-[0.65rem] text-gold font-bold uppercase tracking-[0.2em] mb-2">
                Correction Note
              </p>
              <p className="text-[var(--fg-muted)] text-sm leading-relaxed">
                {article.correctionNote}
              </p>
              <p className="text-[var(--fg-faint)] text-xs mt-2">
                Last updated:{' '}
                {format(new Date(article.updatedAt), 'd MMMM yyyy')}
              </p>
              <p className="text-[var(--fg-faint)] text-xs mt-1">
                <Link href="/corrections" className="text-gold hover:underline">
                  Read our corrections policy
                </Link>
              </p>
            </div>
          </AnimateIn>
        )}

        {/* Series navigation */}
        {article.series && (prevInSeries || nextInSeries) && (
          <AnimateIn variant="fade-up" delay={0.05} className="mt-10 no-print">
            <div className="flex items-center justify-between gap-4 pt-7 border-t border-[var(--border)]">
              {prevInSeries ? (
                <Link href={`/articles/${prevInSeries.slug}`} className="flex flex-col group max-w-[48%]">
                  <span className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-1">← Previous</span>
                  <span className="text-[var(--fg)] text-sm font-semibold group-hover:text-gold transition-colors line-clamp-2" style={{ fontFamily: 'var(--font-serif)' }}>
                    {prevInSeries.title}
                  </span>
                </Link>
              ) : <div />}
              {nextInSeries && (
                <Link href={`/articles/${nextInSeries.slug}`} className="flex flex-col items-end group max-w-[48%]">
                  <span className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-1">Next →</span>
                  <span className="text-[var(--fg)] text-sm font-semibold group-hover:text-gold transition-colors line-clamp-2 text-right" style={{ fontFamily: 'var(--font-serif)' }}>
                    {nextInSeries.title}
                  </span>
                </Link>
              )}
            </div>
          </AnimateIn>
        )}

        {/* Author bio */}
        {article.author.bio && (
          <AnimateIn variant="fade-up" delay={0.05} className="mt-14">
            <div className="p-6 bg-[var(--bg-subtle)] border-l-[3px] border-gold rounded-r-sm">
              <p className="text-[0.65rem] text-gold font-bold uppercase tracking-widest mb-2">
                About the Author
              </p>
              <Link href={authorHref} className="font-semibold text-[var(--fg)] text-sm mb-1.5 hover:text-gold transition-colors block">
                {displayAuthorName(article.author.name)}
              </Link>
              <p className="text-[var(--fg-muted)] text-sm leading-relaxed">{article.author.bio}</p>
            </div>
          </AnimateIn>
        )}

        {/* ── Comment Section ─────────────────────────────────────────────── */}
        <div className="no-print">
          <CommentSection articleId={article.id} currentUser={currentUser} />
        </div>

        {/* Back link */}
        <div className="mt-12 pt-7 border-t border-[var(--border)] no-print">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest hover:gap-3 transition-all duration-200 group"
          >
            <span className="transition-transform duration-200 group-hover:-translate-x-1">←</span>
            Back to Homepage
          </Link>
        </div>
      </div>

      {/* ── Related Articles ── */}
      {related.length > 0 && (
        <div className="bg-[var(--bg-subtle)] border-t border-[var(--border)] py-16 px-4 no-print">
          <div className="max-w-7xl mx-auto">
            <AnimateIn variant="fade-up">
              <div className="flex items-center gap-4 mb-10 max-w-5xl mx-auto">
                <h2
                  className="text-2xl font-bold text-[var(--fg)]"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  Continue Reading
                </h2>
                <div className="flex-1 h-px bg-[var(--border)]" />
              </div>
            </AnimateIn>
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {related.map((rel) => (
                <StaggerItem key={rel.id}>
                  <article className="relative bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden group card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
                    <Link href={`/articles/${rel.slug}`} className="absolute inset-0 z-0" aria-label={rel.title} />
                    <div className="relative h-44 bg-navy/10 overflow-hidden img-zoom flex-shrink-0">
                      {rel.coverImage ? (
                        <Image src={rel.coverImage} alt={rel.title} fill className="object-cover" />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                          <span className="text-gold/15 text-3xl font-bold select-none" style={{ fontFamily: 'var(--font-serif)' }}>TC</span>
                        </div>
                      )}
                      {rel.category && (
                        <div className="absolute top-3 left-3 z-10">
                          <span className="category-badge">{rel.category.name}</span>
                        </div>
                      )}
                    </div>
                    <div className="relative z-10 p-5 flex flex-col flex-1">
                      <h3
                        className="font-bold text-[var(--fg)] text-base leading-snug group-hover:text-gold transition-colors duration-200 line-clamp-2 mb-2 flex-1"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {rel.title}
                      </h3>
                      {rel.excerpt && (
                        <p className="text-[var(--fg-muted)] text-sm leading-relaxed line-clamp-2 mb-3">
                          {rel.excerpt}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-xs text-[var(--fg-faint)] mt-auto pt-3 border-t border-[var(--border)]">
                        <Link
                          href={`/author/${rel.author.slug ?? rel.author.id}`}
                          className="relative z-10 font-semibold text-[var(--fg-muted)] hover:text-gold transition-colors"
                        >
                          {displayAuthorName(rel.author.name)}
                        </Link>
                        {rel.publishedAt && (
                          <span>{format(new Date(rel.publishedAt), 'd MMM yyyy')}</span>
                        )}
                      </div>
                    </div>
                  </article>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </div>
      )}
    </div>
  )
}
