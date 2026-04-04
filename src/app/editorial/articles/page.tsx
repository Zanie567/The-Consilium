import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Articles | Editorial' }

export default async function EditorialArticlesPage() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const isEditor = session.user.role === 'ADMIN' || session.user.role === 'EDITOR'

  const articles = await prisma.article.findMany({
    where: isEditor ? undefined : { authorId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    include: { author: true, category: true },
  }).catch(() => [])

  const statusColour: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600',
    PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
    PUBLISHED: 'bg-green-100 text-green-800',
    ARCHIVED: 'bg-red-100 text-red-700',
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {isEditor ? 'All Articles' : 'My Articles'}
          </h1>
          <p className="text-[var(--fg-muted)] text-sm mt-1">{articles.length} total</p>
        </div>
        <Link
          href="/editorial/articles/new"
          className="bg-navy text-gold px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
        >
          + New Article
        </Link>
      </div>

      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
        {articles.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                <th className="text-left px-6 py-3 text-[var(--fg-faint)] text-xs font-bold uppercase tracking-widest">
                  Title
                </th>
                <th className="text-left px-4 py-3 text-[var(--fg-faint)] text-xs font-bold uppercase tracking-widest hidden sm:table-cell">
                  Category
                </th>
                {isEditor && (
                  <th className="text-left px-4 py-3 text-[var(--fg-faint)] text-xs font-bold uppercase tracking-widest hidden md:table-cell">
                    Author
                  </th>
                )}
                <th className="text-left px-4 py-3 text-[var(--fg-faint)] text-xs font-bold uppercase tracking-widest hidden lg:table-cell">
                  Updated
                </th>
                <th className="px-4 py-3 text-[var(--fg-faint)] text-xs font-bold uppercase tracking-widest">
                  Status
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {articles.map((article) => (
                <tr key={article.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                  <td className="px-6 py-3">
                    <p className="font-medium text-[var(--fg)] line-clamp-1">{article.title}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-muted)] hidden sm:table-cell">
                    {article.category?.name ?? '-'}
                  </td>
                  {isEditor && (
                    <td className="px-4 py-3 text-[var(--fg-muted)] hidden md:table-cell">
                      {article.author.name}
                    </td>
                  )}
                  <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden lg:table-cell">
                    {format(new Date(article.updatedAt), 'd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 ${statusColour[article.status] ?? ''}`}>
                      {article.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/editorial/articles/${article.id}/edit`}
                      className="text-gold text-xs font-bold hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-16 text-center text-[var(--fg-faint)] text-sm">
            No articles yet.
          </div>
        )}
      </div>
    </div>
  )
}
