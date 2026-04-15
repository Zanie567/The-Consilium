import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { NotificationBell } from '@/components/editorial/NotificationBell'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import { DraftsSection } from '@/components/editorial/DraftsSection'
import { FileText, CheckCircle, AlertCircle, BarChart2, Users as UsersIcon } from 'lucide-react'
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

  let assignedCategoryIds: string[] | null = null
  if (role === 'EDITOR') {
    const assignments = await prisma.categoryEditor.findMany({
      where: { userId },
      select: { categoryId: true },
    })
    assignedCategoryIds = assignments.map((a) => a.categoryId)
  }

  const [myArticles, pendingArticles, publishedCount, myDrafts, totalViews, userCount] = await Promise.all([
    prisma.article.findMany({
      where: role === 'WRITER' ? { authorId: userId } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: { category: true, author: true },
    }).catch(() => []),

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

    prisma.article.findMany({
      where: { authorId: userId, status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        content: true,
        category: { select: { name: true } },
      },
    }).catch(() => [] as { id: string; title: string; updatedAt: Date; content: string; category: { name: string } | null }[]),

    isEditor
      ? prisma.article.aggregate({ _sum: { viewCount: true } })
          .then((r) => r._sum.viewCount ?? 0)
          .catch(() => 0)
      : Promise.resolve(0),

    isEditor
      ? prisma.user.count({ where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } } }).catch(() => 0)
      : Promise.resolve(0),
  ])

  const statusColour: Record<string, string> = {
    DRAFT: 'bg-[#f0ede6] text-[#888]',
    PENDING_REVIEW: 'bg-amber-50 text-amber-600',
    PUBLISHED: 'bg-emerald-50 text-emerald-600',
    SCHEDULED: 'bg-blue-50 text-blue-600',
    REJECTED: 'bg-red-50 text-red-500',
    ARCHIVED: 'bg-[#f0ede6] text-[#888]',
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
    <PortalPage className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <PortalSection className="flex items-start justify-between mb-8">
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
      </PortalSection>

      {/* Stats row */}
      <PortalSection className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<FileText size={20} />}
          label="My Drafts"
          value={myDrafts.length}
          accentColor="#1a2744"
          context="current work in progress"
        />
        <StatCard
          icon={<CheckCircle size={20} />}
          label="Published"
          value={publishedCount}
          accentColor="#16a34a"
          context="live on site"
        />
        {isEditor && (
          <StatCard
            icon={<AlertCircle size={20} />}
            label="Pending Review"
            value={pendingArticles.length}
            accentColor={pendingArticles.length > 0 ? '#d97706' : '#1a2744'}
            context={pendingArticles.length > 0 ? 'awaiting editorial review' : 'queue is clear'}
            contextAmber={pendingArticles.length > 0}
          />
        )}
        {isEditor && (
          <StatCard
            icon={<BarChart2 size={20} />}
            label="Total Views"
            value={totalViews.toLocaleString()}
            accentColor="#1a2744"
            context="across all articles"
          />
        )}
        {isEditor && (
          <Link href="/editorial/users">
            <StatCard
              icon={<UsersIcon size={20} />}
              label="Users"
              value={userCount}
              accentColor="#1a2744"
              context="registered team members"
            />
          </Link>
        )}
      </PortalSection>

      {/* Pending Review queue */}
      {isEditor && pendingArticles.length > 0 && (
        <PortalSection className="mb-8">
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
        </PortalSection>
      )}

      {/* Quick actions */}
      <PortalSection className="flex flex-wrap gap-3 mb-8">
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
      </PortalSection>

      {/* My Drafts */}
      {myDrafts.length > 0 && (
        <PortalSection className="mb-8">
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
          <DraftsSection
            drafts={myDrafts.map((draft) => ({
              id: draft.id,
              title: draft.title,
              updatedAt: draft.updatedAt,
              wordCount: wordCount(draft.content),
              category: draft.category,
            }))}
          />
        </PortalSection>
      )}

      {/* Recent articles table */}
      <PortalSection>
        <div className="bg-white rounded-lg border border-[#e8e4d9] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#e8e4d9] flex items-center justify-between">
            <h2 className="text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">
              {role === 'WRITER' ? 'My Articles' : 'Recent Articles'}
            </h2>
            <Link href="/editorial/articles" className="text-xs text-[#c9a84c] hover:underline">
              View all →
            </Link>
          </div>
          {myArticles.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8e4d9]">
                    <th className="text-left px-6 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">
                      Article
                    </th>
                    <th className="text-left px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden sm:table-cell">
                      Category
                    </th>
                    <th className="text-left px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden md:table-cell">
                      Updated
                    </th>
                    <th className="text-right px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8e4d9]">
                  {myArticles.map((article) => (
                    <tr key={article.id} className="hover:bg-[#faf8f4] transition-colors duration-100 cursor-pointer" style={{ height: '56px' }}>
                      <td className="px-6 py-3">
                        <Link
                          href={`/editorial/articles/${article.id}/edit`}
                          className="font-medium text-[#1a2744] hover:text-[#c9a84c] transition-colors line-clamp-1"
                        >
                          {article.title}
                        </Link>
                        {isEditor && (
                          <p className="text-[#888] text-xs mt-0.5">
                            {article.author.name}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#888] text-[13px] hidden sm:table-cell">
                        {article.category?.name ?? 'Uncategorised'}
                      </td>
                      <td className="px-4 py-3 text-[#888] text-[13px] hidden md:table-cell">
                        {format(new Date(article.updatedAt), 'd MMM yyyy')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-[4px] ${statusColour[article.status] ?? ''}`}>
                          {article.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-16 flex flex-col items-center gap-3">
              <FileText size={32} className="text-[#ccc]" />
              <p className="text-[15px] font-semibold text-[#1a2744]">No articles yet</p>
              <p className="text-[13px] text-[#888]">
                <Link href="/editorial/articles/new" className="text-[#c9a84c] hover:underline">
                  Write your first article.
                </Link>
              </p>
            </div>
          )}
        </div>
      </PortalSection>
    </PortalPage>
  )
}

function StatCard({
  icon,
  label,
  value,
  accentColor,
  context,
  contextAmber,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  accentColor: string
  context: string
  contextAmber?: boolean
}) {
  return (
    <div
      className="bg-white rounded-lg p-5 relative overflow-hidden hover:bg-[#faf8f0] transition-colors duration-150 cursor-default border border-[#e8e4d9]"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="absolute top-4 right-4 opacity-35" style={{ color: accentColor }}>
        {icon}
      </div>
      <p className="text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] mb-3">{label}</p>
      <p className="text-[36px] font-semibold text-[#1a2744] leading-none mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p className={`text-[12px] ${contextAmber ? 'text-amber-500 font-medium' : 'text-[#888]'}`}>
        {context}
      </p>
    </div>
  )
}
