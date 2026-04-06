import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format } from 'date-fns'
import { FileText, Send, Archive, Users, Eye } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin Dashboard' }

async function getStats(userId: string, role: string) {
  try {
    const isAdminOrEditor = role === 'ADMIN' || role === 'EDITOR'
    const whereClause = isAdminOrEditor ? {} : { authorId: userId }

    const [total, published, drafts, subscribers, viewsAgg] = await Promise.all([
      prisma.article.count({ where: whereClause }),
      prisma.article.count({ where: { ...whereClause, status: 'PUBLISHED' } }),
      prisma.article.count({ where: { ...whereClause, status: 'DRAFT' } }),
      isAdminOrEditor ? prisma.subscriber.count() : Promise.resolve(null),
      prisma.article.aggregate({ where: whereClause, _sum: { viewCount: true } }),
    ])
    return { total, published, drafts, subscribers, totalViews: viewsAgg._sum.viewCount ?? 0 }
  } catch {
    return { total: 0, published: 0, drafts: 0, subscribers: null, totalViews: 0 }
  }
}

async function getTopArticles(userId: string, role: string) {
  try {
    const isAdminOrEditor = role === 'ADMIN' || role === 'EDITOR'
    const whereClause = isAdminOrEditor
      ? { status: 'PUBLISHED' as const }
      : { authorId: userId, status: 'PUBLISHED' as const }
    return await prisma.article.findMany({
      where: whereClause,
      orderBy: { viewCount: 'desc' },
      take: 5,
      select: { id: true, title: true, slug: true, viewCount: true, category: { select: { name: true } } },
    })
  } catch {
    return []
  }
}

async function getRecentArticles(userId: string, role: string) {
  try {
    const isAdminOrEditor = role === 'ADMIN' || role === 'EDITOR'
    const whereClause = isAdminOrEditor ? {} : { authorId: userId }

    return await prisma.article.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: { author: true, category: true },
    })
  } catch {
    return []
  }
}

const statusColors: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-800',
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
  ARCHIVED: 'bg-red-100 text-red-700',
}

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const { id: userId, role } = session.user
  const isAdminOrEditor = role === 'ADMIN' || role === 'EDITOR'
  const [stats, recentArticles, topArticles] = await Promise.all([
    getStats(userId, role),
    getRecentArticles(userId, role),
    isAdminOrEditor ? getTopArticles(userId, role) : Promise.resolve([]),
  ])

  const statCards = [
    { label: 'Total Articles', value: stats.total, icon: FileText, color: 'text-navy' },
    { label: 'Published', value: stats.published, icon: Send, color: 'text-green-700' },
    { label: 'Drafts', value: stats.drafts, icon: Archive, color: 'text-amber-700' },
    { label: 'Total Views', value: stats.totalViews.toLocaleString(), icon: Eye, color: 'text-purple-700' },
    ...(stats.subscribers !== null
      ? [{ label: 'Subscribers', value: stats.subscribers, icon: Users, color: 'text-blue-700' }]
      : []),
  ]

  return (
    <div>
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-navy"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Dashboard
        </h1>
        <p className="text-navy/50 text-sm mt-1">
          Welcome back, {session.user.name ?? session.user.email}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white border border-gold/15 p-5 rounded-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-navy/50 text-xs font-bold uppercase tracking-widest">
                {card.label}
              </p>
              <card.icon size={18} className={card.color} />
            </div>
            <p className={`text-3xl font-bold ${card.color}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Top articles by views (admin/editor only) */}
      {isAdminOrEditor && topArticles.length > 0 && (
        <div className="bg-white border border-gold/15 rounded-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gold/15 flex items-center justify-between">
            <h2 className="text-navy font-bold text-base flex items-center gap-2">
              <Eye size={16} className="text-purple-600" />
              Top Articles by Views
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gold/10">
                  <th className="text-left px-6 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">Title</th>
                  <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest hidden sm:table-cell">Category</th>
                  <th className="text-right px-6 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gold/10">
                {topArticles.map((article, i) => (
                  <tr key={article.id} className="hover:bg-cream/50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-navy/30 text-xs font-bold w-4">{i + 1}</span>
                        <Link href={`/articles/${article.slug}`} target="_blank" className="text-navy font-medium line-clamp-1 hover:text-gold transition-colors">
                          {article.title}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-navy/60 text-xs hidden sm:table-cell">{article.category?.name ?? '—'}</td>
                    <td className="px-6 py-3 text-right">
                      <span className="text-purple-700 font-bold text-sm">{article.viewCount.toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent articles */}
      <div className="bg-white border border-gold/15 rounded-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gold/15 flex items-center justify-between">
          <h2 className="text-navy font-bold text-base">Recent Articles</h2>
          <Link
            href="/admin/articles"
            className="text-gold text-xs font-bold uppercase tracking-widest hover:opacity-70"
          >
            View all
          </Link>
        </div>

        {recentArticles.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gold/10">
                  <th className="text-left px-6 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest hidden sm:table-cell">
                    Author
                  </th>
                  <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest hidden md:table-cell">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest hidden lg:table-cell">
                    Updated
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gold/10">
                {recentArticles.map((article) => (
                  <tr key={article.id} className="hover:bg-cream/50 transition-colors">
                    <td className="px-6 py-3">
                      <p className="text-navy font-medium line-clamp-1 max-w-xs">
                        {article.title}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-navy/60 hidden sm:table-cell">
                      {article.author.name}
                    </td>
                    <td className="px-4 py-3 text-navy/60 hidden md:table-cell">
                      {article.category?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 text-xs font-bold rounded-sm ${
                          statusColors[article.status] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {article.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-navy/40 text-xs hidden lg:table-cell">
                      {format(new Date(article.updatedAt), 'd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/articles/${article.id}/edit`}
                        className="text-gold text-xs font-bold hover:opacity-70"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-navy/30 text-sm">
            No articles yet.{' '}
            <Link href="/admin/articles/new" className="text-gold hover:opacity-70">
              Create your first article
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
