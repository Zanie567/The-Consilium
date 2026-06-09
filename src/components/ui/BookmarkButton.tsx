'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Bookmark } from 'lucide-react'
import Link from 'next/link'
import { Tooltip } from '@/components/ui/Tooltip'
import { useBookmarks } from '@/hooks/useBookmarks'

export function BookmarkButton({ articleId }: { articleId: string }) {
  const { data: session } = useSession()
  // Shared across every BookmarkButton on the page → one /api/bookmarks fetch,
  // not one per card. See useBookmarks for why.
  const { ids, isLoaded, toggle } = useBookmarks()
  const [loading, setLoading] = useState(false)

  const bookmarked = ids.includes(articleId)

  if (!session) {
    return (
      <Tooltip content="Sign in to save this article to your reading list">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-[var(--fg-faint)] text-xs hover:text-gold transition-colors"
        >
          <Bookmark size={16} />
          <span className="hidden sm:inline">Save</span>
        </Link>
      </Tooltip>
    )
  }

  if (!isLoaded) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs opacity-0 pointer-events-none">
        <Bookmark size={16} />
        <span className="hidden sm:inline">Save</span>
      </div>
    )
  }

  const handleToggle = async () => {
    setLoading(true)
    await toggle(articleId)
    setLoading(false)
  }

  return (
    <Tooltip content={bookmarked ? 'Remove from your saved articles' : 'Save this article to your reading list'}>
      <button
        onClick={handleToggle}
        disabled={loading}
        aria-label={bookmarked ? 'Remove bookmark' : 'Save article'}
        className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
          bookmarked
            ? 'text-gold hover:text-gold/70'
            : 'text-[var(--fg-faint)] hover:text-gold'
        }`}
      >
        <Bookmark size={16} className={bookmarked ? 'fill-gold' : ''} />
        <span className="hidden sm:inline">{bookmarked ? 'Saved' : 'Save'}</span>
      </button>
    </Tooltip>
  )
}
