import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format } from 'date-fns'
import { PlusCircle } from 'lucide-react'
import { ArticleActions } from '@/components/admin/ArticleActions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Articles | Admin' }

const statusColors: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-800',
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
  ARCHIVED: 'bg-red-100 text-red-700',
}

export default async function AdminArticlesPage() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const { id: userId, role } = session.user
  const isAdminOrEditor = role === 'ADMIN' || role === 'EDITOR'

  type ArticleWithRelations = Awaited<ReturnType<typeof prisma.article.findMany<{
    include: { author: true; category: true }
  }>>>[number]

  let articles: ArticleWithRelations[] = []
  try {
    articles = await prisma.article.findMany({
      where: isAdminOrEditor ? {} : { authorId: userId },
      orderBy: { updatedAt: 'desc' },
      include: { author: true, category: true },
    })
  } catch {
    articles = []
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-3xl font-bold text-navy"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Articles
          </h1>
          <p className="text-navy/50 text-sm mt-1">
            {articles.length} total article{articles.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/admin/articles/new"
          className="inline-flex items-center gap-2 bg-navy text-gold px-4 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
        >
          <PlusCircle size={16} />
          New Article
        </Link>
      </div>

      <div className="bg-white border border-gold/15 rounded-sm overflow-hidden">
        {articles.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gold/15 bg-cream/50">
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
                  <th className="px-4 py-3 text-right text-navy/50 text-xs font-bold uppercase tracking-widest">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gold/10">
                {articles.map((article) => (
                  <tr key={article.id} className="hover:bg-cream/30 transition-colors">
                    <td className="px-6 py-3">
                      <p className="text-navy font-medium line-clamp-1 max-w-xs">
                        {article.title}
                      </p>
                      {article.status === 'PUBLISHED' && (
                        <Link
                          href={`/articles/${article.slug}`}
                          className="text-gold text-xs hover:opacity-70"
                          target="_blank"
                        >
                          View ↗
                        </Link>
                      )}
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
                      <ArticleActions
                        articleId={article.id}
                        status={article.status}
                        canPublish={isAdminOrEditor}
                        slug={article.slug}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <p className="text-navy/30 text-sm mb-4">No articles yet.</p>
            <Link
              href="/admin/articles/new"
              className="inline-flex items-center gap-2 bg-navy text-gold px-6 py-3 text-xs font-bold uppercase tracking-widest"
            >
              <PlusCircle size={16} />
              Create your first article
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
