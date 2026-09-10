'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ArticleComment } from '@/components/editorial/CommentsPanel'
import { apiRequest, asApiError } from '@/lib/apiClient'

/**
 * Loads and holds the inline review comments for an article. Shared by the
 * editor review page and the article editor so both surfaces stay in sync
 * with the same API and state shape.
 */
export function useArticleComments(articleId: string | undefined) {
  const [comments, setComments] = useState<ArticleComment[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Clear immediately so a previous article's comments never linger while a
    // new fetch is in flight (or when there is no article at all).
    setComments([])
    setError(null)
    if (!articleId) return
    let cancelled = false
    apiRequest<ArticleComment[]>(`/api/articles/${articleId}/comments`)
      .then((data: ArticleComment[]) => {
        if (!cancelled) setComments(Array.isArray(data) ? data : [])
      })
      .catch((reason) => {
        if (!cancelled) {
          setComments([])
          setError(asApiError(reason).message)
        }
      })
    return () => { cancelled = true }
  }, [articleId])

  const addComment = useCallback((comment: ArticleComment) => {
    setComments((prev) => [...prev, comment])
  }, [])

  const setCommentResolved = useCallback((commentId: string, resolved: boolean) => {
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, resolved } : c)))
  }, [])

  return { comments, error, addComment, setCommentResolved }
}
