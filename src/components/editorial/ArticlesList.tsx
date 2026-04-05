'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { Star, Pin, Trash2, ExternalLink } from 'lucide-react'

interface ArticleItem {
  id: string
  title: string
  status: string
  isFeatured: boolean
  isPinned: boolean
  updatedAt: string
  publishedAt: string | null
  slug: string
  author: { id: string; name: string | null }
  category: { name: string; slug: string } | null
}

interface Props {
  articles: ArticleItem[]
  isEditor: boolean
  isWriter: boolean
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
  PENDING_REVIEW: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  REJECTED: 'bg-red-500/10 text-red-600 dark:text-red-400',
  ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
}

export function ArticlesList({ articles: initial, isEditor, isWriter }: Props) {
  const [articles, setArticles] = useState(initial)
  const [filter, setFilter] = useState<string>('all')

  const toggle = (id: string, field: 'isFeatured' | 'isPinned', value: boolean) => {
    setArticles((prev) => prev.map((a) => {
      if (field === 'isFeatured') return { ...a, isFeatured: a.id === id ? value : false }
      return a.id === id ? { ...a, [field]: value } : a
    }))
  }

  const featureArticle = async (id: string, current: boolean) => {
    const method = current ? 'DELETE' : 'POST'
    const res = await fetch(`/api/editorial/articles/${id}/feature`, { method })
    if (res.ok) toggle(id, 'isFeatured', !current)
  }

  const pinArticle = async (id: string, current: boolean) => {
    const method = current ? 'DELETE' : 'POST'
    const res = await fetch(`/api/editorial/articles/${id}/pin`, { method })
    if (res.ok) toggle(id, 'isPinned', !current)
  }

  const deleteArticle = async (id: string) => {
    if (!confirm('Delete this article? This cannot be undone.')) return
    const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' })
    if (res.ok) setArticles((prev) => prev.filter((a) => a.id !== id))
  }

  const statuses = ['all', ...Array.from(new Set(initial.map((a) => a.status)))]
  const filtered = filter === 'all' ? articles : articles.filter((a) => a.status === filter)

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              filter === s
                ? 'bg-navy text-gold'
                : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold'
            }`}
          >
            {s === 'all' ? 'All' : s.replace('_', ' ')}
            <span className="ml-1.5 opacity-60">
              {s === 'all'
                ? articles.length
                : articles.filter((a) => a.status === s).length}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
        {filtered.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                <th className="px-5 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider">
                  Title
                </th>
                {isEditor && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden md:table-cell">
                    Author
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden sm:table-cell">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden lg:table-cell">
                  Updated
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((article) => (
                <tr key={article.id} className="hover:bg-[var(--bg-subtle)] transition-colors group">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {article.isFeatured && (
                        <Star size={12} className="shrink-0 fill-gold text-gold" />
                      )}
                      {article.isPinned && (
                        <Pin size={12} className="shrink-0 fill-gold text-gold" />
                      )}
                      <span className="font-medium text-[var(--fg)] line-clamp-1">
                        {article.title}
                      </span>
                    </div>
                  </td>
                  {isEditor && (
                    <td className="px-4 py-3 text-[var(--fg-muted)] text-xs hidden md:table-cell">
                      {article.author.name ?? ''}
                    </td>
                  )}
                  <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden sm:table-cell">
                    {article.category?.name ?? 'Uncategorised'}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden lg:table-cell">
                    {format(new Date(article.updatedAt), 'd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 ${STATUS_STYLE[article.status] ?? ''}`}>
                      {article.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {isEditor && article.status === 'PUBLISHED' && (
                        <>
                          <button
                            onClick={() => featureArticle(article.id, article.isFeatured)}
                            title={article.isFeatured ? 'Remove featured' : 'Set as Featured'}
                            className={`p-1.5 transition-colors ${
                              article.isFeatured ? 'text-gold' : 'text-[var(--fg-faint)] hover:text-gold'
                            }`}
                          >
                            <Star size={13} className={article.isFeatured ? 'fill-gold' : ''} />
                          </button>
                          <button
                            onClick={() => pinArticle(article.id, article.isPinned)}
                            title={article.isPinned ? 'Unpin' : 'Pin to category'}
                            className={`p-1.5 transition-colors ${
                              article.isPinned ? 'text-gold' : 'text-[var(--fg-faint)] hover:text-gold'
                            }`}
                          >
                            <Pin size={13} className={article.isPinned ? 'fill-gold' : ''} />
                          </button>
                        </>
                      )}
                      {article.status === 'PUBLISHED' && (
                        <a
                          href={`/articles/${article.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View live"
                          className="p-1.5 text-[var(--fg-faint)] hover:text-gold transition-colors"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {isEditor && article.status === 'PENDING_REVIEW' && (
                        <Link
                          href={`/editorial/review/${article.id}`}
                          className="text-amber-600 text-xs font-bold hover:underline px-1.5 py-1"
                        >
                          Review
                        </Link>
                      )}
                      <Link
                        href={`/editorial/articles/${article.id}/edit`}
                        className="text-gold text-xs font-bold hover:underline px-1.5 py-1"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => deleteArticle(article.id)}
                        title="Delete"
                        className="p-1.5 text-[var(--fg-faint)] hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-16 text-center text-[var(--fg-faint)] text-sm">
            No articles match this filter.
          </div>
        )}
      </div>
    </div>
  )
}
