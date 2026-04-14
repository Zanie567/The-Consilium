import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { NotificationBell } from '@/components/editorial/NotificationBell'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialDashboard() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const userId = session.user.id
  const role = session.user.role
  const isAdmin = role === 'ADMIN'
  const isEditor = role === 'ADMIN' || role === 'EDITOR'

  // Get category IDs this editor is assigned to
  let assignedCategoryIds: string[] | null = null
  if (role === 'EDITOR') {
    const assignments = await prisma.categoryEditor.findMany({
      where: { userId },
      select: { categoryId: true },
    })
    assignedCategoryIds = assignments.map((a) => a.categoryId)
  }

  const [myArticles, pendingArticles, publishedCount, myDrafts, totalViews, userCount] = await Promise.all([
    // Writer: own articles; Editor/Admin: recent across system
    prisma.article.findMany({
      where: role === 'WRITER' ? { authorId: userId } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: { category: true, author: true },
    }).catch(() => []),

    // Pending queue (editor/admin only)
    isEditor
      ? prisma.article.findMany({
          where: {
            status: 'PENDING_REVIEW',
            ...(assignedCategoryIds ? { categoryId: { in: assignedCategoryIds } } : {}),
          },
          orderBy: { updatedAt: 'asc' },
          take: 10,
          include: { author: true, category: true, _count: { select: { views: true } } },
        }).catch(() => [])
      : Promise.resolve([]),

    prisma.article.count({
      where: {
        status: 'PUBLISHED',
        ...(role === 'WRITER' ? { authorId: userId } : {}),
      },
    }).catch(() => 0),

    // My drafts — always the current user's own work-in-progress
    prisma.article.findMany({
      where: { authorId: userId, status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        category: { select: { name: true } },
      },
    }).catch(() => [] as { id: string; title: string; updatedAt: Date; category: { name: string } | null }[]),

    // Total site views (editors/admins only)
    isEditor
      ? prisma.article.aggregate({ _sum: { viewCount: true } })
          .then((r) => r._sum.viewCount ?? 0)
          .catch(() => 0)
      : Promise.resolve(0),

    // Total editorial team members (editors/admins only)
    isEditor
      ? prisma.user.count({ where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } } }).catch(() => 0)
      : Promise.resolve(0),
  ])

  const statusColour: Record<string, string> = {
    DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
    PENDING_REVIEW: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    PUBLISHED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    REJECTED: 'bg-red-500/10 text-red-600 dark:text-red-400',
    ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
  }

  const wordCount = (content: string) => {
    try {
      const parsed = JSON.parse(content)
      const text = JSON.stringify(parsed).replace(/<[^>]+>/g, '')
      return Math.round(text.split(/\s+/).filter(Boolean).length * 0.75)
    } catch {
      return content.split(/\s+/).filter(Boolean).length
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Welcome back.
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            {isAdmin
              ? 'You have full editorial access.'
              : isEditor
              ? 'Manage the review queue and editorial content.'
              : 'Write and manage your articles.'}
          </p>
        </div>
        <NotificationBell />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="My Drafts" value={myDrafts.length} />
        <StatCard label="Published" value={publishedCount} accent="emerald" />
        {isEditor && (
          <StatCard
            label="Pending Review"
            value={pendingArticles.length}
            accent={pendingArticles.length > 0 ? 'amber' : undefined}
          />
        )}
        {isEditor && (
          <StatCard label="Total Views" value={totalViews.toLocaleString()} />
        )}
        {isEditor && (
          <Link href="/editorial/users">
            <StatCard label="Users" value={userCount} />
          </Link>
        )}
      </div>

      {/* Pending Review queue — prominent for editors */}
      {isEditor && pendingArticles.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[var(--fg)] uppercase tracking-widest">
              Pending Review
              <span className="ml-2 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full">
                {pendingArticles.length}
              </span>
            </h2>
          </div>
          <div className="bg-[var(--bg-elevated)] border border-amber-500/20 overflow-hidden shadow-[var(--shadow-card)]">
            {pendingArticles.map((article, i) => (
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
                    {article.author.name} · {article.category?.name ?? 'Uncategorised'} ·{' '}
                    {wordCount(article.content).toLocaleString()} words ·{' '}
                    submitted {formatDistanceToNow(new Date(article.updatedAt), { addSuffix: true })}
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
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3 mb-8">
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
        {isEditor && (
          <Link
            href="/editorial/users"
            className="inline-flex items-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-colors"
          >
            Manage Users
          </Link>
        )}
        {isEditor && (
          <Link
            href="/editorial/series"
            className="inline-flex items-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-colors"
          >
            Article Series
          </Link>
        )}
      </div>

      {/* My Drafts */}
      {myDrafts.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              My Drafts
              <span className="ml-2 text-[var(--fg-faint)] font-normal normal-case tracking-normal">
                {myDrafts.length} saved
              </span>
            </h2>
            <Link
              href="/editorial/articles?status=DRAFT"
              className="text-xs text-gold hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] divide-y divide-[var(--border)]">
            {myDrafts.map((draft) => (
              <Link
                key={draft.id}
                href={`/editorial/articles/${draft.id}/edit`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--fg)] group-hover:text-gold transition-colors line-clamp-1">
                    {draft.title || <span className="italic text-[var(--fg-faint)]">Untitled</span>}
                  </p>
                  <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                    {draft.category?.name ?? 'No category'} · last saved {formatDistanceToNow(new Date(draft.updatedAt), { addSuffix: true })}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold text-gold opacity-0 group-hover:opacity-100 transition-opacity">
                  Continue →
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent articles table */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
            {role === 'WRITER' ? 'My Articles' : 'Recent Articles'}
          </h2>
          <Link href="/editorial/articles" className="text-xs text-gold hover:underline">
            View all →
          </Link>
        </div>
        {myArticles.length > 0 ? (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-6 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                  Article
                </th>
                <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">
                  Category
                </th>
                <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden md:table-cell">
                  Updated
                </th>
                <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
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
                    {isEditor && (
                      <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                        {article.author.name}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden sm:table-cell">
                    {article.category?.name ?? 'Uncategorised'}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden md:table-cell">
                    {format(new Date(article.updatedAt), 'd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-bold px-2 py-0.5 ${statusColour[article.status] ?? ''}`}>
                      {article.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: 'emerald' | 'amber'
}) {
  const valueClass =
    accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-[var(--fg)]'

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
      <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-3xl font-bold ${valueClass}`} style={{ fontFamily: 'var(--font-serif)' }}>
        {value}
      </p>
    </div>
  )
}
