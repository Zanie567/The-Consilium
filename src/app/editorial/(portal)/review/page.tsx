import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Review Queue | Editorial',
  robots: { index: false, follow: false },
}

export default async function ReviewQueuePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') {
    redirect('/editorial')
  }

  let assignedCategoryIds: string[] | null = null
  if (session.user.role === 'EDITOR') {
    const assignments = await prisma.categoryEditor.findMany({
      where: { userId: session.user.id },
      select: { categoryId: true },
    })
    assignedCategoryIds = assignments.map((a) => a.categoryId)
  }

  const articles = await prisma.article.findMany({
    where: {
      status: 'PENDING_REVIEW',
      ...(assignedCategoryIds ? { categoryId: { in: assignedCategoryIds } } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    include: { author: true, category: true },
  }).catch(() => [])

  const wordCount = (content: string) => {
    try {
      const text = JSON.stringify(JSON.parse(content)).replace(/<[^>]+>/g, '')
      return Math.round(text.split(/\s+/).filter(Boolean).length * 0.75)
    } catch {
      return content.split(/\s+/).filter(Boolean).length
    }
  }

  return (
    <PortalPage className="p-6 lg:p-8 max-w-4xl">
      <PortalSection className="mb-8">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Review Queue
        </h1>
        <p className="text-[var(--fg-muted)] text-sm">
          {articles.length === 0
            ? 'No articles are waiting for review.'
            : `${articles.length} article${articles.length !== 1 ? 's' : ''} waiting for review.`}
        </p>
      </PortalSection>

      {articles.length === 0 ? (
        <PortalSection>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] px-6 py-16 text-center">
            <p className="text-[var(--fg-faint)] text-sm">The queue is clear.</p>
            <Link href="/editorial" className="text-gold text-xs hover:underline mt-2 inline-block">
              Back to dashboard
            </Link>
          </div>
        </PortalSection>
      ) : (
        <PortalSection>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
            {articles.map((article, i) => (
              <div
                key={article.id}
                className={`flex items-center gap-4 px-6 py-4 hover:bg-[var(--bg-subtle)] transition-colors ${
                  i > 0 ? 'border-t border-[var(--border)]' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/editorial/review/${article.id}`}
                    className="font-semibold text-[var(--fg)] hover:text-gold transition-colors line-clamp-1 text-sm"
                  >
                    {article.title}
                  </Link>
                  <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                    {article.author.name}
                    {article.category ? ` · ${article.category.name}` : ''}
                    {' · '}{wordCount(article.content).toLocaleString()} words
                    {' · '}submitted {formatDistanceToNow(new Date(article.updatedAt), { addSuffix: true })}
                  </p>
                </div>
                <Link
                  href={`/editorial/review/${article.id}`}
                  className="shrink-0 bg-gold text-navy text-xs font-bold px-4 py-1.5 uppercase tracking-widest hover:bg-gold/90 transition-colors"
                >
                  Review
                </Link>
              </div>
            ))}
          </div>
        </PortalSection>
      )}
    </PortalPage>
  )
}
