'use client'

import { useEffect, useRef } from 'react'

export function ViewCounter({ articleId }: { articleId: string }) {
  const counted = useRef(false)

  useEffect(() => {
    if (counted.current) return
    counted.current = true
    fetch(`/api/editorial/articles/${articleId}/view`, { method: 'POST' }).catch(() => {})
  }, [articleId])

  return null
}
