'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { format } from 'date-fns'
import {
  BookOpen, Bookmark, MessageSquare, Vote, Settings, History,
  Trash2, Pencil, Check, X, AlertTriangle, Copy, CheckCheck,
  ChevronRight, TrendingUp, Clock, Flame, Star, BookMarked,
} from 'lucide-react'
import { readTimeLabel } from '@/lib/readTime'
import { getInitials } from '@/lib/authorUtils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ArticleSnippet {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverImage: string | null
  publishedAt: string | null
  content: string
  author: { name: string | null }
  category: { name: string } | null
}

interface ReadingHistoryItem {
  id: string
  progress: number
  completed: boolean
  updatedAt: string
  article: ArticleSnippet
}

interface SavedArticleItem {
  id: string
  createdAt: string
  article: ArticleSnippet
}

interface DebateVoteItem {
  id: string
  side: 'FOR' | 'AGAINST'
  createdAt: string
  forCount: number
  againstCount: number
  forPct: number
  againstPct: number
  debate: {
    id: string
    title: string
    description: string | null
    isActive: boolean
    closesAt: string | null
    forArticle: { id: string; title: string; slug: string }
    againstArticle: { id: string; title: string; slug: string }
    _count: { votes: number }
  }
}

interface CommentItem {
  id: string
  body: string
  upvotes: number
  createdAt: string
  article: { id: string; title: string; slug: string; category: { name: string } | null }
  _count: { upvotedBy: number }
}

interface Stats {
  totalRead: number
  totalInProgress: number
  totalDebateVotes: number
  totalComments: number
  totalSaved: number
  readingStreak: number
  favouriteCategory: string | null
  readingTimeSavedMins: number
}

type TabId = 'history' | 'reading' | 'saved' | 'debates' | 'comments' | 'settings'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'history',  label: 'Reading History',    icon: <History size={14} /> },
  { id: 'reading',  label: 'Currently Reading',  icon: <BookOpen size={14} /> },
  { id: 'saved',    label: 'Saved Articles',      icon: <Bookmark size={14} /> },
  { id: 'debates',  label: 'Debate Votes',        icon: <Vote size={14} /> },
  { id: 'comments', label: 'My Comments',         icon: <MessageSquare size={14} /> },
  { id: 'settings', label: 'Account Settings',    icon: <Settings size={14} /> },
]

// ─── Small shared components ─────────────────────────────────────────────────

function ArticleThumbnail({ src, title }: { src: string | null; title: string }) {
  return (
    <div className="relative w-16 h-14 shrink-0 overflow-hidden bg-navy/10">
      {src ? (
        <Image src={src} alt={title} fill className="object-cover" sizes="64px" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
          <span className="text-gold/20 text-xs font-bold" style={{ fontFamily: 'var(--font-serif)' }}>TC</span>
        </div>
      )}
    </div>
  )
}

function EmptyState({ icon, title, body, cta }: { icon: React.ReactNode; title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="py-20 text-center border border-dashed border-[var(--border)]">
      <div className="w-10 h-10 mx-auto mb-4 flex items-center justify-center text-gold/30">{icon}</div>
      <p className="text-xl font-bold text-[var(--fg-faint)] mb-2" style={{ fontFamily: 'var(--font-serif)' }}>{title}</p>
      <p className="text-[var(--fg-faint)] text-sm mb-6">{body}</p>
      {cta}
    </div>
  )
}

function TabLoader() {
  return (
    <div className="space-y-3 py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 bg-[var(--bg-elevated)] border border-[var(--border)] animate-pulse" />
      ))}
    </div>
  )
}

// ─── Tab content panels ───────────────────────────────────────────────────────

function ReadingHistoryTab() {
  const [items, setItems] = useState<ReadingHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/profile/reading-history?page=${page}`)
      .then((r) => r.json())
      .then((d) => { setItems(d.items ?? []); setPages(d.pages ?? 1) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page])

  if (loading) return <TabLoader />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<History size={28} />}
        title="No articles read yet"
        body="Articles you finish reading will appear here."
        cta={
          <Link href="/" className="inline-block border border-[var(--fg-faint)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-8 py-3 hover:border-gold hover:text-gold transition-colors">
            Browse Articles
          </Link>
        }
      />
    )
  }

  return (
    <div>
      <div className="space-y-3">
        {items.map(({ id, updatedAt, article }) => (
          <Link
            key={id}
            href={`/articles/${article.slug}`}
            className="flex items-center gap-4 p-3 bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-gold/40 transition-colors group"
          >
            <ArticleThumbnail src={article.coverImage} title={article.title} />
            <div className="flex-1 min-w-0">
              {article.category && (
                <p className="text-gold text-[0.6rem] font-bold uppercase tracking-widest mb-0.5">{article.category.name}</p>
              )}
              <p className="text-[var(--fg)] font-semibold text-sm leading-snug group-hover:text-gold transition-colors line-clamp-1" style={{ fontFamily: 'var(--font-serif)' }}>
                {article.title}
              </p>
              <p className="text-[var(--fg-faint)] text-[10px] mt-0.5">{article.author.name}</p>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-[var(--fg-faint)] text-[10px] block">{format(new Date(updatedAt), 'd MMM yyyy')}</span>
              <span className="text-gold text-[10px] font-semibold flex items-center gap-1 justify-end mt-1">
                <Check size={10} /> Read
              </span>
            </div>
          </Link>
        ))}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs font-bold uppercase tracking-widest text-[var(--fg-faint)] hover:text-gold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-[var(--fg-faint)] text-xs">{page} / {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="text-xs font-bold uppercase tracking-widest text-[var(--fg-faint)] hover:text-gold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function CurrentlyReadingTab() {
  const [items, setItems] = useState<ReadingHistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/reading-progress')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setItems(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <TabLoader />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title="Nothing in progress"
        body="Start reading an article and come back here to pick up where you left off."
        cta={
          <Link href="/" className="inline-block border border-[var(--fg-faint)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-8 py-3 hover:border-gold hover:text-gold transition-colors">
            Browse Articles
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Link
          key={item.article.id}
          href={`/articles/${item.article.slug}`}
          className="flex items-center gap-4 p-3 bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-gold/40 transition-colors group"
        >
          <ArticleThumbnail src={item.article.coverImage} title={item.article.title} />
          <div className="flex-1 min-w-0">
            {item.article.category && (
              <p className="text-gold text-[0.6rem] font-bold uppercase tracking-widest mb-0.5">{item.article.category.name}</p>
            )}
            <p className="text-[var(--fg)] font-semibold text-sm leading-snug group-hover:text-gold transition-colors line-clamp-1" style={{ fontFamily: 'var(--font-serif)' }}>
              {item.article.title}
            </p>
            <p className="text-[var(--fg-faint)] text-[10px] mt-0.5">{item.article.author.name}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span className="text-[var(--fg-faint)] text-[10px] font-semibold">{Math.round(item.progress)}%</span>
            <div className="w-20 h-1 bg-[var(--border)] overflow-hidden">
              <div className="h-full bg-gold transition-all" style={{ width: `${Math.min(item.progress, 100)}%` }} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

function SavedArticlesTab() {
  const [items, setItems] = useState<SavedArticleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/profile/saved-articles')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setItems(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleRemove = async (articleId: string) => {
    setRemoving(articleId)
    await fetch(`/api/profile/saved-articles?articleId=${articleId}`, { method: 'DELETE' })
    setItems((prev) => prev.filter((i) => i.article.id !== articleId))
    setRemoving(null)
  }

  if (loading) return <TabLoader />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark size={28} />}
        title="No saved articles yet"
        body="Bookmark articles while reading to find them here."
        cta={
          <Link href="/" className="inline-block border border-[var(--fg-faint)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-8 py-3 hover:border-gold hover:text-gold transition-colors">
            Browse Articles
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {items.map(({ id, createdAt, article }) => (
        <div key={id} className="flex items-center gap-4 p-3 bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-gold/40 transition-colors group">
          <ArticleThumbnail src={article.coverImage} title={article.title} />
          <div className="flex-1 min-w-0">
            {article.category && (
              <p className="text-gold text-[0.6rem] font-bold uppercase tracking-widest mb-0.5">{article.category.name}</p>
            )}
            <Link href={`/articles/${article.slug}`}>
              <p className="text-[var(--fg)] font-semibold text-sm leading-snug hover:text-gold transition-colors line-clamp-1" style={{ fontFamily: 'var(--font-serif)' }}>
                {article.title}
              </p>
            </Link>
            <p className="text-[var(--fg-faint)] text-[10px] mt-0.5">
              {article.author.name}
              {article.content && <span className="ml-2 text-[var(--fg-faint)]">{readTimeLabel(article.content)}</span>}
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <span className="text-[var(--fg-faint)] text-[10px]">{format(new Date(createdAt), 'd MMM yyyy')}</span>
            <button
              onClick={() => handleRemove(article.id)}
              disabled={removing === article.id}
              className="text-[var(--fg-faint)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
              aria-label="Remove bookmark"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function DebateVotesTab() {
  const [items, setItems] = useState<DebateVoteItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/profile/debate-votes')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setItems(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <TabLoader />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Vote size={28} />}
        title="No debate votes yet"
        body="Vote in an Opinion Debate and your votes will be recorded here."
        cta={
          <Link href="/opinion-debate" className="inline-block border border-[var(--fg-faint)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-8 py-3 hover:border-gold hover:text-gold transition-colors">
            View Debates
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const isFor = item.side === 'FOR'
        const winningPct = isFor ? item.forPct : item.againstPct
        const winning = winningPct > 50

        return (
          <div key={item.id} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1 min-w-0">
                <p className="text-[var(--fg)] font-bold text-sm leading-snug" style={{ fontFamily: 'var(--font-serif)' }}>
                  {item.debate.title}
                </p>
                <p className="text-[var(--fg-faint)] text-[10px] mt-1">{format(new Date(item.createdAt), 'd MMM yyyy')}</p>
              </div>
              <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 ${isFor ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                Voted {isFor ? 'For' : 'Against'}
              </span>
            </div>

            {/* Vote bar */}
            <div className="flex items-center gap-2 text-[10px] mb-2">
              <span className="text-emerald-500 font-bold w-8 text-right">{item.forPct}%</span>
              <div className="flex-1 h-1.5 bg-[var(--border)] overflow-hidden flex">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${item.forPct}%` }} />
                <div className="h-full bg-red-500 transition-all flex-1" />
              </div>
              <span className="text-red-500 font-bold w-8">{item.againstPct}%</span>
            </div>

            <div className="flex items-center gap-4 text-[10px] text-[var(--fg-faint)]">
              <span>{item.debate._count.votes} votes total</span>
              {winning && <span className="text-gold font-semibold">Your side is winning</span>}
              <Link href="/opinion-debate" className="ml-auto flex items-center gap-1 hover:text-gold transition-colors">
                View debate <ChevronRight size={10} />
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MyCommentsTab() {
  const [items, setItems] = useState<CommentItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/profile/comments')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setItems(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <TabLoader />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare size={28} />}
        title="No comments yet"
        body="Join the conversation by leaving a comment on any article."
        cta={
          <Link href="/" className="inline-block border border-[var(--fg-faint)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-8 py-3 hover:border-gold hover:text-gold transition-colors">
            Browse Articles
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex-1 min-w-0">
              {item.article.category && (
                <p className="text-gold text-[0.6rem] font-bold uppercase tracking-widest mb-0.5">{item.article.category.name}</p>
              )}
              <Link href={`/articles/${item.article.slug}`} className="text-[var(--fg-muted)] text-xs font-semibold hover:text-gold transition-colors line-clamp-1">
                {item.article.title}
              </Link>
            </div>
            <span className="shrink-0 text-[var(--fg-faint)] text-[10px]">{format(new Date(item.createdAt), 'd MMM yyyy')}</span>
          </div>
          <p className="text-[var(--fg)] text-sm leading-relaxed line-clamp-3">{item.body}</p>
          {item._count.upvotedBy > 0 && (
            <p className="text-[var(--fg-faint)] text-[10px] mt-2">{item._count.upvotedBy} upvote{item._count.upvotedBy !== 1 ? 's' : ''}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function AccountSettingsTab({
  initialName,
  initialBio,
  email,
  onNameChange,
}: {
  initialName: string | null
  initialBio: string | null
  email: string
  onNameChange: (name: string) => void
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName ?? '')
  const [bio, setBio] = useState(initialBio ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [copied, setCopied] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/profile/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio }),
      })
      if (!res.ok) throw new Error('Save failed')
      const data = await res.json()
      onNameChange(data.name ?? name)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setSaveError('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/profile/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Delete failed')
      }
      await signOut({ redirect: false })
      router.push('/?deleted=true')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const handleCopyProfile = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/profile`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-8 max-w-lg">
      {/* Profile details */}
      <section>
        <h3 className="text-[var(--fg)] font-bold text-sm uppercase tracking-widest mb-4">Profile Details</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-widest mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={60}
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg)] text-sm px-3 py-2 outline-none focus:border-gold/60 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-widest mb-1.5">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us a little about yourself..."
              maxLength={300}
              rows={3}
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg)] text-sm px-3 py-2 outline-none focus:border-gold/60 transition-colors resize-none"
            />
            <p className="text-[var(--fg-faint)] text-[10px] mt-1 text-right">{bio.length}/300</p>
          </div>
          <div>
            <label className="block text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-widest mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg-faint)] text-sm px-3 py-2 opacity-60 cursor-not-allowed"
            />
            <p className="text-[var(--fg-faint)] text-[10px] mt-1">Email address cannot be changed here.</p>
          </div>
          {saveError && <p className="text-red-500 text-xs">{saveError}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-gold text-navy text-xs font-bold uppercase tracking-widest px-5 py-2.5 hover:bg-gold/90 disabled:opacity-60 transition-colors"
          >
            {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving...' : <><Pencil size={13} /> Save Changes</>}
          </button>
        </div>
      </section>

      {/* Share profile */}
      <section>
        <h3 className="text-[var(--fg)] font-bold text-sm uppercase tracking-widest mb-4">Share Your Profile</h3>
        <div className="flex items-center gap-3 p-3 bg-[var(--bg-elevated)] border border-[var(--border)]">
          <p className="flex-1 text-[var(--fg-faint)] text-xs truncate">{typeof window !== 'undefined' ? window.location.origin : ''}/profile</p>
          <button
            onClick={handleCopyProfile}
            className="shrink-0 flex items-center gap-1.5 text-[var(--fg-faint)] hover:text-gold text-xs font-semibold transition-colors"
          >
            {copied ? <><CheckCheck size={13} className="text-gold" /> Copied</> : <><Copy size={13} /> Copy link</>}
          </button>
        </div>
      </section>

      {/* Danger zone */}
      <section>
        <h3 className="text-red-500 font-bold text-sm uppercase tracking-widest mb-4">Danger Zone</h3>
        <div className="border border-red-500/20 p-4">
          <p className="text-[var(--fg)] text-sm font-semibold mb-1">Delete your account</p>
          <p className="text-[var(--fg-faint)] text-xs mb-4 leading-relaxed">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          {!deleteOpen ? (
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-2 border border-red-500/40 text-red-500 text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={13} /> Delete Account
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-amber-500 bg-amber-500/10 p-3">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  This will permanently delete your account, reading history, bookmarks, comments, and all other data. Type your email address to confirm.
                </p>
              </div>
              <input
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={`Type "${email}" to confirm`}
                className="w-full bg-[var(--bg-elevated)] border border-red-500/40 text-[var(--fg)] text-sm px-3 py-2 outline-none focus:border-red-500 transition-colors"
              />
              {deleteError && <p className="text-red-500 text-xs">{deleteError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={handleDelete}
                  disabled={deleting || confirmEmail.toLowerCase() !== email.toLowerCase()}
                  className="flex items-center gap-2 bg-red-600 text-white text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 size={13} /> {deleting ? 'Deleting...' : 'Permanently Delete'}
                </button>
                <button
                  onClick={() => { setDeleteOpen(false); setConfirmEmail(''); setDeleteError('') }}
                  className="flex items-center gap-2 border border-[var(--border)] text-[var(--fg-faint)] text-xs font-bold uppercase tracking-widest px-4 py-2 hover:border-gold/40 hover:text-gold transition-colors"
                >
                  <X size={13} /> Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatPill({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3 bg-[var(--bg-elevated)] border border-[var(--border)] min-w-[80px]">
      <span className="text-gold/60">{icon}</span>
      <span className="text-[var(--fg)] font-bold text-lg leading-none">{value}</span>
      <span className="text-[var(--fg-faint)] text-[9px] font-semibold uppercase tracking-widest text-center leading-tight">{label}</span>
    </div>
  )
}

// ─── Main exported component ──────────────────────────────────────────────────

interface ProfileTabsProps {
  initialName: string | null
  initialBio: string | null
  email: string
  image: string | null
  createdAt: string
  initialTab?: TabId
  role: string
}

export function ProfileTabs({ initialName, initialBio, email, image, createdAt, initialTab, role }: ProfileTabsProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'history')
  const [displayName, setDisplayName] = useState(initialName)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/profile/stats')
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {})
  }, [])

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    router.replace(url.pathname + url.search, { scroll: false })
  }

  const initials = displayName ? getInitials(displayName) : (email?.charAt(0).toUpperCase() ?? '?')

  return (
    <div>
      {/* Profile header */}
      <section className="bg-navy py-12 px-4 border-b border-gold/25">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-5 mb-6">
            {image ? (
              <Image src={image} alt={displayName ?? ''} width={72} height={72} className="rounded-full object-cover ring-2 ring-gold/30 shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gold/20 flex items-center justify-center text-gold text-2xl font-bold shrink-0">
                {initials}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-cream" style={{ fontFamily: 'var(--font-serif)' }}>
                {displayName ?? email}
              </h1>
              <p className="text-cream/50 text-sm mt-0.5">{email}</p>
              <div className="flex items-center gap-3 mt-1.5">
                <p className="text-cream/35 text-xs">Member since {format(new Date(createdAt), 'MMMM yyyy')}</p>
                {['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'].includes(role) && (
                  <span className="text-gold text-[9px] font-bold uppercase tracking-widest border border-gold/30 px-1.5 py-0.5">
                    {role}
                  </span>
                )}
                {stats?.favouriteCategory && (
                  <span className="text-cream/40 text-[9px] font-semibold uppercase tracking-widest flex items-center gap-1">
                    <Star size={9} className="text-gold/50" /> {stats.favouriteCategory}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stats pills */}
          {stats && (
            <div className="flex flex-wrap gap-2">
              <StatPill icon={<BookMarked size={14} />} value={stats.totalRead} label="Read" />
              <StatPill icon={<BookOpen size={14} />} value={stats.totalInProgress} label="In Progress" />
              <StatPill icon={<Bookmark size={14} />} value={stats.totalSaved} label="Saved" />
              <StatPill icon={<Vote size={14} />} value={stats.totalDebateVotes} label="Votes" />
              <StatPill icon={<MessageSquare size={14} />} value={stats.totalComments} label="Comments" />
              {stats.readingStreak > 1 && (
                <StatPill icon={<Flame size={14} />} value={`${stats.readingStreak}d`} label="Streak" />
              )}
              {stats.readingTimeSavedMins >= 5 && (
                <StatPill icon={<Clock size={14} />} value={stats.readingTimeSavedMins >= 60 ? `${Math.round(stats.readingTimeSavedMins / 60)}h` : `${stats.readingTimeSavedMins}m`} label="Reading time" />
              )}
            </div>
          )}
        </div>
      </section>

      {/* Tab nav */}
      <div className="border-b border-[var(--border)] bg-[var(--bg)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-0 overflow-x-auto" aria-label="Profile tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap border-b-2 transition-colors duration-150 ${
                  activeTab === tab.id
                    ? 'border-gold text-gold'
                    : 'border-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'history'  && <ReadingHistoryTab />}
        {activeTab === 'reading'  && <CurrentlyReadingTab />}
        {activeTab === 'saved'    && <SavedArticlesTab />}
        {activeTab === 'debates'  && <DebateVotesTab />}
        {activeTab === 'comments' && <MyCommentsTab />}
        {activeTab === 'settings' && (
          <AccountSettingsTab
            initialName={initialName}
            initialBio={initialBio}
            email={email}
            onNameChange={setDisplayName}
          />
        )}
      </div>

      {/* Trending/recommendations link if we know their category */}
      {stats?.favouriteCategory && activeTab !== 'settings' && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <Link
            href={`/category/${stats.favouriteCategory.toLowerCase()}`}
            className="flex items-center gap-3 p-4 border border-[var(--border)] hover:border-gold/40 transition-colors group"
          >
            <TrendingUp size={16} className="text-gold/60 shrink-0" />
            <div>
              <p className="text-[var(--fg)] text-sm font-semibold group-hover:text-gold transition-colors">
                More from {stats.favouriteCategory}
              </p>
              <p className="text-[var(--fg-faint)] text-xs">Your most read category</p>
            </div>
            <ChevronRight size={14} className="text-[var(--fg-faint)] ml-auto group-hover:text-gold transition-colors" />
          </Link>
        </div>
      )}
    </div>
  )
}
