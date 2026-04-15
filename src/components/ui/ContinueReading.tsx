'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { BookOpen } from 'lucide-react'

interface ProgressItem {
  progress: number
  scrollY: number
  article: {
    id: string
    title: string
    slug: string
    coverImage: string | null
    excerpt: string | null
    author: { name: string | null; slug: string | null; id: string }
    category: { name: string } | null
  }
}

// localStorage-based guest progress (all articles with saved progress)
function getGuestProgress(): ProgressItem[] {
  try {
    const items: ProgressItem[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('consilium_rp_')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const { progress, scrollY } = JSON.parse(raw) as { progress: number; scrollY: number }
      if (progress < 3 || progress > 95) continue
      const articleId = key.replace('consilium_rp_', '')
      items.push({
        progress,
        scrollY,
        article: { id: articleId, title: '', slug: articleId, coverImage: null, excerpt: null, author: { name: null, slug: null, id: '' }, category: null },
      })
    }
    return items
  } catch {
    return []
  }
}

export function ContinueReading() {
  const { data: session, status } = useSession()
  const [items, setItems] = useState<ProgressItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (status === 'loading') return

    if (session?.user?.id) {
      fetch('/api/reading-progress')
        .then((r) => r.json())
        .then((data: ProgressItem[]) => {
          if (Array.isArray(data)) setItems(data)
        })
        .catch(() => {})
        .finally(() => setLoaded(true))
    } else {
      // Guests - we only have IDs in localStorage, not full article data
      // Just show a generic invite if they have any saved progress
      const guest = getGuestProgress()
      if (guest.length > 0) {
        setItems(guest) // will render with limited info for guests
      }
      setLoaded(true)
    }
  }, [session, status])

  if (!loaded || items.length === 0) return null

  return (
    <div className="border-t border-[var(--border)] pt-10 mt-14">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={14} className="text-gold/60" />
        <span className="text-gold/50 text-[0.65rem] font-bold tracking-[0.3em] uppercase">Continue Reading</span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>

      {session?.user?.id ? (
        <div className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.article.id}
              href={`/articles/${item.article.slug}`}
              className="flex items-center gap-4 p-3 bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-gold/40 transition-colors group"
            >
              {/* Thumbnail */}
              <div className="relative w-14 h-12 shrink-0 overflow-hidden bg-navy/10">
                {item.article.coverImage ? (
                  <Image src={item.article.coverImage} alt={item.article.title} fill className="object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                    <span className="text-gold/20 text-xs font-bold" style={{ fontFamily: 'var(--font-serif)' }}>TC</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {item.article.category && (
                  <p className="text-gold text-[0.6rem] font-bold uppercase tracking-widest mb-0.5">
                    {item.article.category.name}
                  </p>
                )}
                <p
                  className="text-[var(--fg)] font-semibold text-sm leading-snug group-hover:text-gold transition-colors line-clamp-1"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {item.article.title}
                </p>
                <p className="text-[var(--fg-faint)] text-[10px] mt-0.5">
                  {item.article.author.name}
                </p>
              </div>

              {/* Progress bar */}
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className="text-[var(--fg-faint)] text-[10px] font-semibold">
                  {Math.round(item.progress)}%
                </span>
                <div className="w-20 h-1 bg-[var(--border)] overflow-hidden">
                  <div
                    className="h-full bg-gold transition-all"
                    style={{ width: `${Math.min(item.progress, 100)}%` }}
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        // Guest: just show a prompt to sign in
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 flex items-center gap-5">
          <div className="shrink-0 w-10 h-10 bg-gold/10 flex items-center justify-center">
            <BookOpen size={18} className="text-gold" />
          </div>
          <div className="flex-1">
            <p className="text-[var(--fg)] text-sm font-semibold mb-0.5">
              You have {items.length} article{items.length > 1 ? 's' : ''} in progress
            </p>
            <p className="text-[var(--fg-faint)] text-xs">
              <Link href="/signup" className="text-gold hover:underline">Create a free account</Link> to save your progress across all your devices.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
