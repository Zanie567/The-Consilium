'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiRequest,asApiError } from '@/lib/apiClient'
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
  const router = useRouter()
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [error,setError]=useState('')
  const [marking,setMarking]=useState(false)
  const markingRef=useRef(false)

  useEffect(() => {
    fetch('/api/editorial/notifications')
      .then((r) => {if(r.status!==200)throw new Error('Notifications could not be loaded.');return r.json()})
      .then((data) => {
        if (Array.isArray(data)) setNotifs(data)
      })
      .catch(()=>setError('Notifications could not be loaded. Reload this page to try again.'))
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

  // Bug 8: optimistically mark all notifications as read in local state and
  // persist to the server.  Using the functional setState form guarantees we
  // always operate on the latest state, avoiding any stale-closure issues.
  const markAllRead = async () => {
    if(markingRef.current)return
    markingRef.current=true;setMarking(true);setError('')
    const unreadIds=new Set(notifs.filter(n=>!n.read).map(n=>n.id))
    setNotifs(prev=>prev.map(n=>({...n,read:true})))
    try {await apiRequest('/api/editorial/notifications',{method:'PATCH'})}
    catch(reason){setNotifs(prev=>prev.map(n=>unreadIds.has(n.id)?{...n,read:false}:n));setError(asApiError(reason).message)}
    finally{markingRef.current=false;setMarking(false)}
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
          if (!open && unread > 0) void markAllRead()
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

      {error && !open && <p role="alert" className="absolute right-0 top-full mt-2 w-80 bg-[var(--bg-elevated)] border border-[var(--border)] p-3 text-red-500 text-sm z-50">{error}</p>}

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              Notifications
            </span>
            {/* Bug 8: only offer "Mark all read" when there are actually unread
                notifications so clicking it always produces a visible change */}
            {unread > 0 && (
              <button
                onClick={()=>void markAllRead()}
                disabled={marking}
                className="text-xs text-gold hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          {error&&<p role="alert" className="px-4 py-3 text-red-500 text-sm">{error}</p>}
          {notifs.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--fg-faint)] text-xs">
              No notifications
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {notifs.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-[var(--border)] last:border-0 flex gap-2.5 ${
                    !n.read ? 'bg-gold/5' : ''
                  }`}
                >
                  {/* Bug 8: unread dot indicator that disappears once read */}
                  <div className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full transition-colors duration-200"
                    style={{ background: n.read ? 'transparent' : 'var(--color-gold, #b8972e)' }}
                  />
                  <div className="flex-1 min-w-0">
                    {n.articleId ? (
                      <Link
                        href={
                          n.type === 'article_submitted'
                            ? `/editorial/review/${n.articleId}`
                            : `/editorial/articles/${n.articleId}/edit`
                        }
                        onNavigate={(event) => {
                          if (n.read) { setOpen(false); return }
                          event.preventDefault()
                          if (markingRef.current) return
                          markingRef.current = true
                          setMarking(true)
                          setError('')
                          // Keep the error and unread item reachable until the
                          // acknowledgement succeeds; the editor has its own header.
                          void apiRequest(`/api/editorial/notifications/${n.id}`, { method: 'PATCH' })
                            .then(() => {
                              setNotifs(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item))
                              setOpen(false)
                              router.push(n.type === 'article_submitted'
                                ? `/editorial/review/${n.articleId}`
                                : `/editorial/articles/${n.articleId}/edit`)
                            })
                            .catch(reason => setError(asApiError(reason).message))
                            .finally(() => { markingRef.current = false; setMarking(false) })
                        }}
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
