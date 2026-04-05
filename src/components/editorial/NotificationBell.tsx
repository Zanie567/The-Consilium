'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { Tooltip } from '@/components/ui/Tooltip'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  createdAt: string
  article: { slug: string } | null
  articleId: string | null
}

export function NotificationBell() {
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/editorial/notifications')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setNotifs(data)
      })
      .catch(() => {})
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const unread = notifs.filter((n) => !n.read).length

  const markAllRead = () => {
    fetch('/api/editorial/notifications', { method: 'PATCH' }).catch(() => {})
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  return (
    <div ref={ref} className="relative">
      <Tooltip
        content={unread > 0 ? `You have ${unread} unread notification${unread > 1 ? 's' : ''} requiring your attention` : 'No new notifications'}
        variant="editorial"
        side="bottom"
      >
      <button
        onClick={() => {
          setOpen((o) => !o)
          if (!open && unread > 0) markAllRead()
        }}
        className="relative p-2 text-[var(--fg-muted)] hover:text-gold transition-colors"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-gold text-navy text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              Notifications
            </span>
            {notifs.length > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-gold hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          {notifs.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--fg-faint)] text-xs">
              No notifications
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {notifs.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-[var(--border)] last:border-0 ${
                    !n.read ? 'bg-gold/5' : ''
                  }`}
                >
                  {n.articleId ? (
                    <Link
                      href={
                        n.type === 'article_submitted'
                          ? `/editorial/review/${n.articleId}`
                          : `/editorial/articles/${n.articleId}/edit`
                      }
                      onClick={() => setOpen(false)}
                      className="block"
                    >
                      <p className="text-xs font-semibold text-[var(--fg)] mb-0.5">{n.title}</p>
                      <p className="text-xs text-[var(--fg-muted)] line-clamp-2">{n.message}</p>
                      <p className="text-[var(--fg-faint)] text-[10px] mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </Link>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-[var(--fg)] mb-0.5">{n.title}</p>
                      <p className="text-xs text-[var(--fg-muted)] line-clamp-2">{n.message}</p>
                      <p className="text-[var(--fg-faint)] text-[10px] mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
