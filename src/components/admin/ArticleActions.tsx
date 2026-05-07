'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Trash2, Edit } from 'lucide-react'

interface ArticleActionsProps {
  articleId: string
  status: string
  canPublish: boolean
  slug: string
}

export function ArticleActions({ articleId, status, canPublish, slug: _slug }: ArticleActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this article?')) return
    setLoading(true)
    try {
      await fetch(`/api/articles/${articleId}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const handlePublish = async () => {
    setLoading(true)
    try {
      await fetch(`/api/articles/${articleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
        }),
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canPublish && (
        <button
          onClick={handlePublish}
          disabled={loading}
          className={`text-xs font-bold px-2 py-1 transition-colors disabled:opacity-50 ${
            status === 'PUBLISHED'
              ? 'text-amber-700 hover:bg-amber-50'
              : 'text-green-700 hover:bg-green-50'
          }`}
        >
          {status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
        </button>
      )}
      <Link
        href={`/admin/articles/${articleId}/edit`}
        className="text-navy/60 hover:text-navy p-1 transition-colors"
        title="Edit"
      >
        <Edit size={15} />
      </Link>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="text-red-400 hover:text-red-600 p-1 transition-colors disabled:opacity-50"
        title="Delete"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}
