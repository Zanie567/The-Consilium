import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Editorial Dashboard | The Consilium' }

export default async function EditorialDashboard() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const userId = session.user.id
  const isEditor = session.user.role === 'ADMIN' || session.user.role === 'EDITOR'

  const [myArticles, pendingCount] = await Promise.all([
    prisma.article.findMany({
      where: isEditor ? undefined : { authorId: userId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { category: true },
    }).catch(() => []),
    prisma.article.count({
      where: { status: 'PENDING_REVIEW' },
    }).catch(() => 0),
  ])

  const statusColour: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    PENDING_REVIEW: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    PUBLISHED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    ARCHIVED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1
          className="text-2xl font-bold text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Welcome back, {session.user.name?.split(' ')[0] ?? 'Editor'}
        </h1>
        <p className="text-[var(--fg-muted)] text-sm mt-1">
          {isEditor ? 'Manage all articles and the editorial pipeline.' : 'Write and manage your articles.'}
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-1">
            {isEditor ? 'Total Articles' : 'My Articles'}
          </p>
          <p className="text-3xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            {myArticles.length}
          </p>
        </div>
        {isEditor && (
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
            <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-1">
              Pending Review
            </p>
            <p className="text-3xl font-bold text-gold" style={{ fontFamily: 'var(--font-serif)' }}>
              {pendingCount}
            </p>
          </div>
        )}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-1">Published</p>
          <p className="text-3xl font-bold text-green-600" style={{ fontFamily: 'var(--font-serif)' }}>
            {myArticles.filter((a) => a.status === 'PUBLISHED').length}
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="flex gap-3 mb-8">
        <Link
          href="/editorial/articles/new"
          className="inline-flex items-center gap-2 bg-navy text-gold px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
        >
          + New Article
        </Link>
        <Link
          href="/editorial/articles"
          className="inline-flex items-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-colors"
        >
          All Articles
        </Link>
      </div>

      {/* Recent articles */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-bold text-[var(--fg)] uppercase tracking-widest">
            Recent Articles
          </h2>
        </div>
        {myArticles.length > 0 ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {myArticles.map((article) => (
                <tr key={article.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                  <td className="px-6 py-3">
                    <Link
                      href={`/editorial/articles/${article.id}/edit`}
                      className="font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1"
                    >
                      {article.title}
                    </Link>
                    <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                      {article.category?.name ?? 'Uncategorised'} &middot;{' '}
                      {format(new Date(article.updatedAt), 'd MMM yyyy')}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 ${statusColour[article.status] ?? ''}`}
                    >
                      {article.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-16 text-center text-[var(--fg-faint)] text-sm">
            No articles yet.{' '}
            <Link href="/editorial/articles/new" className="text-gold hover:underline">
              Write your first article.
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
