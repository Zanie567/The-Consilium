'use client'

import { useEffect, useRef } from 'react'

function getOrCreateSessionId(): string {
  try {
    const key = 'consilium_sid'
    let sid = localStorage.getItem(key)
    if (!sid) {
      sid = crypto.randomUUID()
      localStorage.setItem(key, sid)
    }
    return sid
  } catch {
    return crypto.randomUUID()
  }
}

export function ViewCounter({ articleId }: { articleId: string }) {
  const counted = useRef(false)

  useEffect(() => {
    if (counted.current) return
    counted.current = true
    const sessionId = getOrCreateSessionId()
    const referrer = document.referrer || ''
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId, sessionId, referrer }),
    }).catch(() => {})
  }, [articleId])

  return null
}
