'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Bookmark } from 'lucide-react'
import Link from 'next/link'

export function BookmarkButton({ articleId }: { articleId: string }) {
  const { data: session } = useSession()
  const [bookmarked, setBookmarked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!session) return
    fetch('/api/bookmarks')
      .then((r) => r.json())
      .then((ids: string[]) => {
        if (Array.isArray(ids)) setBookmarked(ids.includes(articleId))
        setChecked(true)
      })
      .catch(() => setChecked(true))
  }, [session, articleId])

  if (!session) {
    return (
      <Link
        href="/login"
        title="Sign in to bookmark"
        className="inline-flex items-center gap-1.5 text-[var(--fg-faint)] text-xs hover:text-gold transition-colors"
      >
        <Bookmark size={16} />
        <span className="hidden sm:inline">Save</span>
      </Link>
    )
  }

  if (!checked) return null

  const handleToggle = async () => {
    setLoading(true)
    const res = await fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId }),
    })
    if (res.ok) {
      const data = await res.json()
      setBookmarked(data.bookmarked)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      title={bookmarked ? 'Remove bookmark' : 'Save article'}
      className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
        bookmarked
          ? 'text-gold hover:text-gold/70'
          : 'text-[var(--fg-faint)] hover:text-gold'
      }`}
    >
      <Bookmark size={16} className={bookmarked ? 'fill-gold' : ''} />
      <span className="hidden sm:inline">{bookmarked ? 'Saved' : 'Save'}</span>
    </button>
  )
}
