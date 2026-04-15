'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export const DRAFTS_SWR_KEY = '/api/editorial/articles?mine=true&status=DRAFT'
import { formatDistanceToNow } from 'date-fns'
import { Trash2 } from 'lucide-react'

interface Draft {
  id: string
  title: string
  updatedAt: Date | string
  wordCount: number
  category: { name: string } | null
}

export function DraftsSection({ drafts }: { drafts: Draft[] }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      await fetch(`/api/articles/${id}`, { method: 'DELETE' })
      router.refresh()
    } catch {
      // silently ignore
    } finally {
      setDeleting(null)
      setConfirmId(null)
    }
  }

  if (drafts.length === 0) return null

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] divide-y divide-[var(--border)]">
      {drafts.map((draft) => (
        <div key={draft.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors group">
          <Link
            href={`/editorial/articles/${draft.id}/edit`}
            className="flex-1 min-w-0"
          >
            <p className="text-sm font-medium text-[var(--fg)] group-hover:text-gold transition-colors line-clamp-1">
              {draft.title || <span className="italic text-[var(--fg-faint)]">Untitled</span>}
            </p>
            <p className="text-xs text-[var(--fg-faint)] mt-0.5">
              {draft.category?.name ?? 'No category'}
              {draft.wordCount > 0 && (
                <> · {draft.wordCount.toLocaleString()} {draft.wordCount === 1 ? 'word' : 'words'}</>
              )}
              {' '}&middot; saved {formatDistanceToNow(new Date(draft.updatedAt), { addSuffix: true })}
            </p>
          </Link>

          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs font-bold text-gold opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
              Continue →
            </span>

            {confirmId === draft.id ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--fg-faint)]">Delete?</span>
                <button
                  onClick={() => handleDelete(draft.id)}
                  disabled={deleting === draft.id}
                  className="text-xs font-semibold text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
                >
                  {deleting === draft.id ? 'Deleting...' : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="text-xs text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.preventDefault(); setConfirmId(draft.id) }}
                className="text-[var(--fg-faint)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                aria-label="Delete draft"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
