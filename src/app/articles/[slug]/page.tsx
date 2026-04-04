import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { ShareButtons } from '@/components/ui/ShareButtons'
import { ReadingProgress } from '@/components/ui/ReadingProgress'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
}

async function getArticle(slug: string) {
  try {
    return await prisma.article.findUnique({
      where: { slug, status: 'PUBLISHED' },
      include: { author: true, category: true },
    })
  } catch {
    return null
  }
}

async function getRelatedArticles(categoryId: string | null | undefined, currentId: string) {
  try {
    return await prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        id: { not: currentId },
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 3,
      include: { author: true, category: true },
    })
  } catch {
    return []
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticle(slug)
  if (!article) return {}
  return {
    title: article.title,
    description: article.excerpt ?? undefined,
    openGraph: {
      title: article.title,
      description: article.excerpt ?? undefined,
      images: article.coverImage ? [article.coverImage] : [],
    },
  }
}

function renderContent(content: string) {
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return tiptapJsonToHtml(parsed)
    }
  } catch {
    // Not JSON, treat as HTML
  }
  return content
}

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

function tiptapJsonToHtml(doc: { type: string; content?: TiptapNode[] }): string {
  if (!doc.content) return ''
  return doc.content.map(nodeToHtml).join('')
}

function nodeToHtml(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${node.content?.map(nodeToHtml).join('') ?? ''}</p>`
    case 'heading': {
      const level = (node.attrs?.level as number) ?? 2
      return `<h${level}>${node.content?.map(nodeToHtml).join('') ?? ''}</h${level}>`
    }
    case 'text': {
      let text = node.text ?? ''
      if (node.marks) {
        node.marks.forEach((mark: TiptapMark) => {
          if (mark.type === 'bold')      text = `<strong>${text}</strong>`
          if (mark.type === 'italic')    text = `<em>${text}</em>`
          if (mark.type === 'underline') text = `<u>${text}</u>`
          if (mark.type === 'highlight') text = `<mark>${text}</mark>`
          if (mark.type === 'link')
            text = `<a href="${mark.attrs?.href ?? '#'}" target="${mark.attrs?.target ?? '_self'}">${text}</a>`
        })
      }
      return text
    }
    case 'bulletList':  return `<ul>${node.content?.map(nodeToHtml).join('') ?? ''}</ul>`
    case 'orderedList': return `<ol>${node.content?.map(nodeToHtml).join('') ?? ''}</ol>`
    case 'listItem':    return `<li>${node.content?.map(nodeToHtml).join('') ?? ''}</li>`
    case 'blockquote':  return `<blockquote>${node.content?.map(nodeToHtml).join('') ?? ''}</blockquote>`
    case 'horizontalRule': return `<hr />`
    case 'image':
      return `<img src="${node.attrs?.src ?? ''}" alt="${node.attrs?.alt ?? ''}" />`
    case 'hardBreak': return `<br />`
    default:
      return node.content?.map(nodeToHtml).join('') ?? ''
  }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const article = await getArticle(slug)

  if (!article) notFound()

  const related = await getRelatedArticles(article.categoryId, article.id)
  const htmlContent = renderContent(article.content)

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Reading progress bar */}
      <ReadingProgress />

      {/* ── Cover Image ──────────────────────────────────────────────────── */}
      {article.coverImage && (
        <div className="relative h-72 sm:h-96 md:h-[520px] w-full overflow-hidden bg-navy">
          <Image
            src={article.coverImage}
            alt={article.title}
            fill
            className="object-cover opacity-75"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy/75 via-navy/20 to-transparent" />
        </div>
      )}

      {/* ── Article header ───────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Category breadcrumb */}
        {article.category && (
          <AnimateIn variant="fade-in" duration={0.4}>
            <Link
              href={`/category/${article.category.slug}`}
              className="inline-block category-badge mb-7 hover:opacity-80 transition-opacity"
            >
              {article.category.name}
            </Link>
          </AnimateIn>
        )}

        {/* Title */}
        <AnimateIn variant="fade-up" delay={0.05} duration={0.6}>
          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-bold text-[var(--fg)] leading-tight mb-6 tracking-tight"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {article.title}
          </h1>
        </AnimateIn>

        {/* Excerpt / pull quote */}
        {article.excerpt && (
          <AnimateIn variant="fade-up" delay={0.1} duration={0.55}>
            <p className="text-[var(--fg-muted)] text-lg sm:text-xl leading-relaxed mb-8 border-l-[3px] border-gold pl-5 italic">
              {article.excerpt}
            </p>
          </AnimateIn>
        )}

        {/* Author + Date + Share */}
        <AnimateIn variant="fade-up" delay={0.15} duration={0.5}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-7 border-b border-[var(--border)] mb-12">
            <div className="flex items-center gap-4">
              {article.author.image ? (
                <Image
                  src={article.author.image}
                  alt={article.author.name ?? ''}
                  width={44}
                  height={44}
                  className="rounded-full object-cover ring-2 ring-gold/20"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-navy flex items-center justify-center text-gold font-bold text-base ring-2 ring-gold/20">
                  {article.author.name?.charAt(0) ?? '?'}
                </div>
              )}
              <div>
                <p className="text-[var(--fg)] font-semibold text-sm">
                  {article.author.name}
                </p>
                <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                  {article.publishedAt
                    ? format(new Date(article.publishedAt), 'd MMMM yyyy')
                    : ''}
                </p>
              </div>
            </div>
            <ShareButtons title={article.title} />
          </div>
        </AnimateIn>

        {/* Article content */}
        <AnimateIn variant="fade-up" delay={0.2} duration={0.6}>
          <div
            className="prose-consilium"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </AnimateIn>

        {/* Author bio */}
        {article.author.bio && (
          <AnimateIn variant="fade-up" delay={0.05} className="mt-14">
            <div className="p-6 bg-[var(--bg-subtle)] border-l-[3px] border-gold rounded-r-sm">
              <p className="text-[0.65rem] text-gold font-bold uppercase tracking-widest mb-2">
                About the Author
              </p>
              <p className="font-semibold text-[var(--fg)] text-sm mb-1.5">
                {article.author.name}
              </p>
              <p className="text-[var(--fg-muted)] text-sm leading-relaxed">
                {article.author.bio}
              </p>
            </div>
          </AnimateIn>
        )}

        {/* Back link */}
        <div className="mt-12 pt-7 border-t border-[var(--border)]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest hover:gap-3 transition-all duration-200 group"
          >
            <span className="transition-transform duration-200 group-hover:-translate-x-1">←</span>
            Back to Homepage
          </Link>
        </div>
      </div>

      {/* ── Related Articles ─────────────────────────────────────────────── */}
      {related.length > 0 && (
        <div className="bg-[var(--bg-subtle)] border-t border-[var(--border)] py-16 px-4">
          <div className="max-w-7xl mx-auto">
            <AnimateIn variant="fade-up">
              <h2
                className="text-2xl font-bold text-[var(--fg)] mb-10 text-center"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                Related Articles
              </h2>
            </AnimateIn>
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {related.map((rel) => (
                <StaggerItem key={rel.id}>
                  <article className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden group card-hover shadow-[var(--shadow-card)] h-full flex flex-col">
                    <div className="relative h-44 bg-navy/10 overflow-hidden img-zoom flex-shrink-0">
                      {rel.coverImage ? (
                        <Image
                          src={rel.coverImage}
                          alt={rel.title}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light" />
                      )}
                      {rel.category && (
                        <div className="absolute top-3 left-3 z-10">
                          <span className="category-badge">{rel.category.name}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-4 flex flex-col flex-1">
                      <Link href={`/articles/${rel.slug}`} className="flex-1">
                        <h3
                          className="font-bold text-[var(--fg)] text-base leading-snug group-hover:text-gold transition-colors duration-200 line-clamp-2 mb-2"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          {rel.title}
                        </h3>
                      </Link>
                      <p className="text-xs text-[var(--fg-faint)] mt-auto">
                        {rel.author.name}
                        {rel.publishedAt && (
                          <> &middot; {format(new Date(rel.publishedAt), 'd MMM yyyy')}</>
                        )}
                      </p>
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
