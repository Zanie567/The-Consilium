import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Scheduled Articles | Editorial',
  robots: { index: false, follow: false },
}

export default async function ScheduledPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') {
    redirect('/editorial')
  }

  const articles = await prisma.article.findMany({
    where: { status: 'SCHEDULED' },
    orderBy: { scheduledAt: 'asc' },
    include: { author: true, category: true },
  })

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Scheduled Articles
        </h1>
        <p className="text-[var(--fg-muted)] text-sm">
          {articles.length === 0
            ? 'No articles are currently scheduled.'
            : `${articles.length} article${articles.length === 1 ? '' : 's'} queued for publication.`}
        </p>
      </div>

      {articles.length > 0 && (
        <div className="space-y-0 divide-y divide-[var(--border)] border border-[var(--border)]">
          {articles.map((article) => {
            const now = new Date()
            const due = article.scheduledAt ? new Date(article.scheduledAt) : null
            const overdue = due && due < now

            return (
              <div key={article.id} className="flex items-start justify-between gap-4 px-5 py-4 bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] transition-colors">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/editorial/articles/${article.id}/edit`}
                    className="font-semibold text-[var(--fg)] hover:text-gold transition-colors text-sm line-clamp-1"
                    style={{ fontFamily: 'var(--font-serif)' }}
                  >
                    {article.title}
                  </Link>
                  <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                    {article.author.name}
                    {article.category && ` · ${article.category.name}`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {due ? (
                    <>
                      <p className={`text-xs font-semibold ${overdue ? 'text-red-500' : 'text-blue-500'}`}>
                        {overdue ? 'Overdue' : format(due, 'd MMM yyyy')}
                      </p>
                      <p className="text-[var(--fg-faint)] text-[10px] mt-0.5">
                        {format(due, 'HH:mm')}
                      </p>
                    </>
                  ) : (
                    <p className="text-amber-500 text-xs font-semibold">No date set</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {articles.length === 0 && (
        <div className="border border-dashed border-[var(--border)] py-16 text-center">
          <p className="text-[var(--fg-faint)] text-sm">
            Articles set to &ldquo;Scheduled&rdquo; status will appear here.
          </p>
        </div>
      )}
    </div>
  )
}
