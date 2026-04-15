'use client'

import { useState, useEffect, useRef } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  X, Shield, AlertTriangle, Ban, Trash2, ChevronDown,
  Plus, Check, BookOpen, Bookmark, MessageSquare, Vote,
  FileText, Eye,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserDetail {
  id: string
  name: string | null
  email: string
  role: string
  isActive: boolean
  isBanned: boolean
  bannedAt: string | null
  bannedReason: string | null
  bannedBy: string | null
  createdAt: string
  lastActiveAt: string | null
  lastLoginAt: string | null
  adminNotes: string | null
  _count: {
    articles: number
    comments: number
    warnings: number
    debateVotes: number
    bookmarks: number
    readingProgress: number
  }
  articles: {
    id: string
    title: string
    slug: string
    status: string
    viewCount: number
    createdAt: string
    publishedAt: string | null
    category: { name: string } | null
  }[]
  comments: {
    id: string
    body: string
    createdAt: string
    isHidden: boolean
    _count: { upvotedBy: number }
    article: { id: string; title: string; slug: string }
  }[]
  debateVotes: {
    id: string
    side: string
    createdAt: string
    debate: { id: string; title: string }
  }[]
  warnings: { id: string; reason: string; issuedBy: string; createdAt: string }[]
  notes: { id: string; note: string; authorId: string; authorName: string | null; createdAt: string }[]
  readingProgress: {
    id: string
    progress: number
    completed: boolean
    updatedAt: string
    article: { id: string; title: string; slug: string }
  }[]
}

const ROLE_COLOURS: Record<string, string> = {
  ADMIN:  'bg-navy text-gold border border-gold/30',
  EDITOR: 'bg-teal-800/80 text-teal-200',
  WRITER: 'bg-gold/20 text-gold',
  READER: 'bg-[var(--border)] text-[var(--fg-muted)]',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatPill({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] min-w-[60px]">
      <span className="text-gold/60">{icon}</span>
      <span className="text-[var(--fg)] font-bold text-base leading-none">{value}</span>
      <span className="text-[var(--fg-faint)] text-[8px] uppercase tracking-widest text-center">{label}</span>
    </div>
  )
}

function StatusBadge({ isBanned }: { isBanned: boolean }) {
  return (
    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 ${isBanned ? 'bg-red-500/15 text-red-500' : 'bg-green-500/15 text-green-500'}`}>
      {isBanned ? 'Banned' : 'Active'}
    </span>
  )
}

function ArticleStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PUBLISHED: 'bg-green-500/15 text-green-600',
    DRAFT: 'bg-[var(--border)] text-[var(--fg-faint)]',
    PENDING_REVIEW: 'bg-amber-500/15 text-amber-600',
    REJECTED: 'bg-red-500/15 text-red-500',
    ARCHIVED: 'bg-navy/30 text-[var(--fg-faint)]',
    SCHEDULED: 'bg-blue-500/15 text-blue-500',
  }
  return (
    <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 ${map[status] ?? ''}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────

interface Props {
  userId: string
  onClose: () => void
  onUserUpdated: () => void
  currentAdminId: string
}

type TabId = 'overview' | 'content' | 'activity'

export function UserDetailPanel({ userId, onClose, onUserUpdated, currentAdminId }: Props) {
  const [user, setUser] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Action states
  const [roleOpen, setRoleOpen] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)
  const [warnOpen, setWarnOpen] = useState(false)
  const [warnReason, setWarnReason] = useState('')
  const [warnLoading, setWarnLoading] = useState(false)
  const [banOpen, setBanOpen] = useState(false)
  const [banReason, setBanReason] = useState('')
  const [banLoading, setBanLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [hiddenComments, setHiddenComments] = useState<Set<string>>(new Set())

  const panelRef = useRef<HTMLDivElement>(null)

  const load = () => {
    setLoading(true)
    fetch(`/api/admin/users/${userId}`)
      .then((r) => r.json())
      .then((d) => setUser(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [userId])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const handleRoleChange = async (role: string) => {
    setRoleLoading(true)
    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    setRoleLoading(false)
    setRoleOpen(false)
    if (res.ok) {
      showToast(`Role changed to ${role}`)
      load(); onUserUpdated()
    } else {
      const d = await res.json()
      showToast(d.error ?? 'Failed to change role')
    }
  }

  const handleWarn = async () => {
    if (!warnReason.trim()) return
    setWarnLoading(true)
    const res = await fetch(`/api/admin/users/${userId}/warn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: warnReason }),
    })
    setWarnLoading(false)
    if (res.ok) {
      setWarnOpen(false); setWarnReason('')
      showToast('Warning sent')
      load(); onUserUpdated()
    } else {
      showToast('Failed to send warning')
    }
  }

  const handleBan = async () => {
    if (!banReason.trim()) return
    setBanLoading(true)
    const res = await fetch(`/api/admin/users/${userId}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: banReason }),
    })
    setBanLoading(false)
    if (res.ok) {
      setBanOpen(false); setBanReason('')
      showToast('Account banned')
      load(); onUserUpdated()
    } else {
      const d = await res.json()
      showToast(d.error ?? 'Failed to ban')
    }
  }

  const handleUnban = async () => {
    const res = await fetch(`/api/admin/users/${userId}/unban`, { method: 'POST' })
    if (res.ok) { showToast('Account unbanned'); load(); onUserUpdated() }
    else showToast('Failed to unban')
  }

  const handleDelete = async () => {
    if (!user || deleteConfirm.toLowerCase() !== user.email.toLowerCase()) return
    setDeleteLoading(true)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail: deleteConfirm }),
    })
    setDeleteLoading(false)
    if (res.ok) { onClose(); onUserUpdated() }
    else {
      const d = await res.json()
      showToast(d.error ?? 'Failed to delete')
    }
  }

  const handleAddNote = async () => {
    if (!noteText.trim()) return
    setNoteLoading(true)
    const res = await fetch(`/api/admin/users/${userId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: noteText }),
    })
    setNoteLoading(false)
    if (res.ok) { setNoteText(''); load() }
    else showToast('Failed to add note')
  }

  const handleDeleteNote = async (noteId: string) => {
    await fetch(`/api/admin/users/${userId}/notes/${noteId}`, { method: 'DELETE' })
    load()
  }

  const handleRemoveComment = async (commentId: string) => {
    const res = await fetch(`/api/admin/users/${userId}/comments/${commentId}`, { method: 'DELETE' })
    if (res.ok) {
      setHiddenComments((prev) => new Set([...prev, commentId]))
      showToast('Comment removed')
    }
  }

  if (loading || !user) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[640px] bg-[var(--bg-elevated)] border-l border-[var(--border)] shadow-2xl flex items-center justify-center">
          <div className="space-y-3 w-64">
            <div className="h-6 bg-[var(--border)] animate-pulse rounded" />
            <div className="h-4 bg-[var(--border)] animate-pulse rounded w-3/4" />
            <div className="h-4 bg-[var(--border)] animate-pulse rounded w-1/2" />
          </div>
        </div>
      </>
    )
  }

  const initials = (user.name || user.email).charAt(0).toUpperCase()
  const isSelf = user.id === currentAdminId

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[640px] bg-[var(--bg-elevated)] border-l border-[var(--border)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Toast */}
        {toast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-navy text-cream text-xs font-semibold px-4 py-2 border border-gold/30 shadow-lg">
            {toast}
          </div>
        )}

        {/* Panel header */}
        <div className="flex-shrink-0 bg-navy border-b border-gold/20 px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-gold/20 flex items-center justify-center text-gold text-xl font-bold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-cream font-bold text-lg leading-tight" style={{ fontFamily: 'var(--font-serif)' }}>
                  {user.name ?? user.email}
                </h2>
                <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 ${ROLE_COLOURS[user.role]}`}>
                  {user.role}
                </span>
                <StatusBadge isBanned={user.isBanned} />
              </div>
              <p className="text-cream/50 text-xs mt-0.5">{user.email}</p>
              <p className="text-cream/35 text-[10px] mt-0.5">Joined {format(new Date(user.createdAt), 'MMMM yyyy')}</p>
            </div>
            <button onClick={onClose} className="text-cream/40 hover:text-cream transition-colors shrink-0 p-1">
              <X size={18} />
            </button>
          </div>

          {/* Action buttons */}
          {!isSelf && (
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              {/* Change role */}
              <div className="relative">
                <button
                  onClick={() => setRoleOpen((o) => !o)}
                  disabled={roleLoading}
                  className="flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg)] text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:border-gold/40 transition-colors"
                >
                  <Shield size={11} /> Change Role <ChevronDown size={10} />
                </button>
                {roleOpen && (
                  <div className="absolute top-full left-0 mt-1 z-10 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg min-w-[120px]">
                    {['ADMIN', 'EDITOR', 'WRITER', 'READER'].filter((r) => r !== user.role).map((r) => (
                      <button
                        key={r}
                        onClick={() => handleRoleChange(r)}
                        className="w-full text-left px-4 py-2 text-xs text-[var(--fg)] hover:bg-gold/10 hover:text-gold transition-colors"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Warn */}
              <button
                onClick={() => setWarnOpen((o) => !o)}
                className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-amber-500/20 transition-colors"
              >
                <AlertTriangle size={11} /> Warn
              </button>

              {/* Ban / Unban */}
              {user.isBanned ? (
                <button
                  onClick={handleUnban}
                  className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/30 text-green-500 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-green-500/20 transition-colors"
                >
                  <Check size={11} /> Unban
                </button>
              ) : (
                <button
                  onClick={() => setBanOpen((o) => !o)}
                  className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-red-500/20 transition-colors"
                >
                  <Ban size={11} /> Ban
                </button>
              )}

              {/* Delete */}
              {user.role !== 'ADMIN' && (
                <button
                  onClick={() => setDeleteOpen((o) => !o)}
                  className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 size={11} /> Delete
                </button>
              )}
            </div>
          )}

          {/* Inline forms */}
          {warnOpen && (
            <div className="mt-3 space-y-2 bg-amber-500/5 border border-amber-500/20 p-3">
              <p className="text-amber-500 text-xs font-semibold">Issue a warning</p>
              <textarea
                value={warnReason}
                onChange={(e) => setWarnReason(e.target.value)}
                placeholder="Reason for warning..."
                rows={2}
                className="w-full bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)] text-xs px-2 py-1.5 outline-none focus:border-amber-500/50 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={handleWarn} disabled={warnLoading || !warnReason.trim()} className="bg-amber-500 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-amber-600 disabled:opacity-40 transition-colors">
                  {warnLoading ? 'Sending...' : 'Send Warning'}
                </button>
                <button onClick={() => { setWarnOpen(false); setWarnReason('') }} className="text-[var(--fg-faint)] text-[10px] hover:text-[var(--fg)] transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {banOpen && (
            <div className="mt-3 space-y-2 bg-red-500/5 border border-red-500/20 p-3">
              <p className="text-red-500 text-xs font-semibold">Ban this account</p>
              <textarea
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Reason for ban (visible to the user)..."
                rows={2}
                className="w-full bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)] text-xs px-2 py-1.5 outline-none focus:border-red-500/50 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={handleBan} disabled={banLoading || !banReason.trim()} className="bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-red-700 disabled:opacity-40 transition-colors">
                  {banLoading ? 'Banning...' : 'Confirm Ban'}
                </button>
                <button onClick={() => { setBanOpen(false); setBanReason('') }} className="text-[var(--fg-faint)] text-[10px] hover:text-[var(--fg)] transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {deleteOpen && (
            <div className="mt-3 space-y-2 bg-red-500/5 border border-red-500/20 p-3">
              <p className="text-red-500 text-xs font-semibold">Permanently delete this account</p>
              <p className="text-[var(--fg-faint)] text-[10px]">Type <span className="font-mono text-red-400">{user.email}</span> to confirm</p>
              <input
                type="email"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={user.email}
                className="w-full bg-[var(--bg)] border border-red-500/40 text-[var(--fg)] text-xs px-2 py-1.5 outline-none focus:border-red-500"
              />
              <div className="flex gap-2">
                <button onClick={handleDelete} disabled={deleteLoading || deleteConfirm.toLowerCase() !== user.email.toLowerCase()} className="bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-red-700 disabled:opacity-40 transition-colors">
                  {deleteLoading ? 'Deleting...' : 'Delete Account'}
                </button>
                <button onClick={() => { setDeleteOpen(false); setDeleteConfirm('') }} className="text-[var(--fg-faint)] text-[10px] hover:text-[var(--fg)] transition-colors">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Stats strip */}
        <div className="flex-shrink-0 border-b border-[var(--border)] px-4 py-3">
          <div className="flex gap-2 flex-wrap">
            <StatPill icon={<FileText size={12} />} value={user._count.articles} label="Articles" />
            <StatPill icon={<MessageSquare size={12} />} value={user._count.comments} label="Comments" />
            <StatPill icon={<Vote size={12} />} value={user._count.debateVotes} label="Votes" />
            <StatPill icon={<BookOpen size={12} />} value={user._count.readingProgress} label="Read" />
            <StatPill icon={<AlertTriangle size={12} />} value={user._count.warnings} label="Warnings" />
            <StatPill icon={<Bookmark size={12} />} value={user._count.bookmarks} label="Saved" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 border-b border-[var(--border)]">
          <div className="flex">
            {(['overview', 'content', 'activity'] as TabId[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-colors ${
                  activeTab === tab ? 'border-gold text-gold' : 'border-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <>
              {/* Account details */}
              <section>
                <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest mb-3">Account Details</h3>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex gap-3"><dt className="text-[var(--fg-faint)] w-28 shrink-0">Email</dt><dd className="text-[var(--fg)]">{user.email}</dd></div>
                  <div className="flex gap-3"><dt className="text-[var(--fg-faint)] w-28 shrink-0">Role</dt><dd><span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 ${ROLE_COLOURS[user.role]}`}>{user.role}</span></dd></div>
                  <div className="flex gap-3"><dt className="text-[var(--fg-faint)] w-28 shrink-0">Joined</dt><dd className="text-[var(--fg)]">{format(new Date(user.createdAt), 'd MMM yyyy')}</dd></div>
                  <div className="flex gap-3"><dt className="text-[var(--fg-faint)] w-28 shrink-0">Last Active</dt><dd className="text-[var(--fg)]">{user.lastActiveAt ? formatDistanceToNow(new Date(user.lastActiveAt), { addSuffix: true }) : 'Never'}</dd></div>
                  <div className="flex gap-3"><dt className="text-[var(--fg-faint)] w-28 shrink-0">Last Login</dt><dd className="text-[var(--fg)]">{user.lastLoginAt ? format(new Date(user.lastLoginAt), 'd MMM yyyy HH:mm') : 'Never'}</dd></div>
                  {user.isBanned && (
                    <>
                      <div className="flex gap-3"><dt className="text-[var(--fg-faint)] w-28 shrink-0">Banned At</dt><dd className="text-red-400">{user.bannedAt ? format(new Date(user.bannedAt), 'd MMM yyyy HH:mm') : 'Unknown'}</dd></div>
                      <div className="flex gap-3"><dt className="text-[var(--fg-faint)] w-28 shrink-0">Ban Reason</dt><dd className="text-red-400">{user.bannedReason}</dd></div>
                    </>
                  )}
                </dl>
              </section>

              {/* Warnings */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest">
                    Warnings ({user.warnings.length})
                  </h3>
                  {!isSelf && (
                    <button
                      onClick={() => setWarnOpen((o) => !o)}
                      className="flex items-center gap-1 text-amber-500 text-[9px] font-bold uppercase tracking-widest hover:text-amber-400 transition-colors"
                    >
                      <Plus size={10} /> Issue Warning
                    </button>
                  )}
                </div>
                {user.warnings.length === 0 ? (
                  <p className="text-[var(--fg-faint)] text-xs">No warnings issued.</p>
                ) : (
                  <div className="space-y-2">
                    {user.warnings.map((w) => (
                      <div key={w.id} className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-sm">
                        <p className="text-[var(--fg)] text-xs leading-relaxed">{w.reason}</p>
                        <p className="text-amber-500/70 text-[9px] mt-1">
                          Issued by {w.issuedBy} — {format(new Date(w.createdAt), 'd MMM yyyy HH:mm')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Admin notes */}
              <section>
                <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest mb-3">
                  Admin Notes (private)
                </h3>
                <div className="space-y-2 mb-3">
                  {user.notes.length === 0 ? (
                    <p className="text-[var(--fg-faint)] text-xs">No notes yet.</p>
                  ) : (
                    user.notes.map((n) => (
                      <div key={n.id} className="flex items-start gap-2 bg-navy/20 border border-[var(--border)] p-3">
                        <div className="flex-1">
                          <p className="text-[var(--fg)] text-xs leading-relaxed">{n.note}</p>
                          <p className="text-[var(--fg-faint)] text-[9px] mt-1">
                            {n.authorName ?? n.authorId} — {format(new Date(n.createdAt), 'd MMM yyyy HH:mm')}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteNote(n.id)}
                          className="text-[var(--fg-faint)] hover:text-red-400 transition-colors shrink-0"
                          aria-label="Delete note"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a private admin note..."
                    rows={2}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)] text-xs px-2 py-1.5 outline-none focus:border-gold/50 resize-none"
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={noteLoading || !noteText.trim()}
                    className="flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-muted)] text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:border-gold/40 hover:text-gold disabled:opacity-40 transition-colors"
                  >
                    <Plus size={10} /> {noteLoading ? 'Saving...' : 'Add Note'}
                  </button>
                </div>
              </section>
            </>
          )}

          {/* CONTENT TAB */}
          {activeTab === 'content' && (
            <>
              {/* Articles */}
              <section>
                <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest mb-3">
                  Articles ({user.articles.length})
                </h3>
                {user.articles.length === 0 ? (
                  <p className="text-[var(--fg-faint)] text-xs">No articles.</p>
                ) : (
                  <div className="space-y-1.5">
                    {user.articles.map((a) => (
                      <a
                        key={a.id}
                        href={`/editorial/articles/${a.id}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-2 bg-[var(--bg)] border border-[var(--border)] hover:border-gold/30 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[var(--fg)] text-xs font-semibold group-hover:text-gold transition-colors line-clamp-1">{a.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {a.category && <span className="text-gold text-[8px] font-bold uppercase tracking-widest">{a.category.name}</span>}
                            <span className="text-[var(--fg-faint)] text-[9px]">{format(new Date(a.createdAt), 'd MMM yyyy')}</span>
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <ArticleStatusBadge status={a.status} />
                          <span className="text-[var(--fg-faint)] text-[9px] flex items-center gap-0.5"><Eye size={9} />{a.viewCount}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </section>

              {/* Comments */}
              <section>
                <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest mb-3">
                  Comments ({user.comments.length})
                </h3>
                {user.comments.length === 0 ? (
                  <p className="text-[var(--fg-faint)] text-xs">No comments.</p>
                ) : (
                  <div className="space-y-2">
                    {user.comments.filter((c) => !hiddenComments.has(c.id)).map((c) => (
                      <div key={c.id} className="flex gap-3 p-3 bg-[var(--bg)] border border-[var(--border)]">
                        <div className="flex-1 min-w-0">
                          <a href={`/articles/${c.article.slug}#comments`} target="_blank" rel="noopener noreferrer"
                            className="text-gold text-[9px] font-bold uppercase tracking-widest hover:underline line-clamp-1 block">
                            {c.article.title}
                          </a>
                          <p className="text-[var(--fg)] text-xs mt-0.5 line-clamp-2">{c.body}</p>
                          <div className="flex items-center gap-3 mt-1 text-[9px] text-[var(--fg-faint)]">
                            <span>{format(new Date(c.createdAt), 'd MMM yyyy')}</span>
                            {c._count.upvotedBy > 0 && <span>{c._count.upvotedBy} upvotes</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveComment(c.id)}
                          className="shrink-0 text-[var(--fg-faint)] hover:text-red-400 transition-colors"
                          title="Remove comment"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {/* ACTIVITY TAB */}
          {activeTab === 'activity' && (
            <>
              {/* Debate votes */}
              <section>
                <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest mb-3">Debate Votes</h3>
                {user.debateVotes.length === 0 ? (
                  <p className="text-[var(--fg-faint)] text-xs">No votes.</p>
                ) : (
                  <div className="space-y-1.5">
                    {user.debateVotes.map((v) => (
                      <div key={v.id} className="flex items-center gap-3 p-2 bg-[var(--bg)] border border-[var(--border)]">
                        <span className={`shrink-0 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 ${v.side === 'FOR' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                          {v.side}
                        </span>
                        <p className="flex-1 text-[var(--fg)] text-xs line-clamp-1">{v.debate.title}</p>
                        <span className="shrink-0 text-[var(--fg-faint)] text-[9px]">{format(new Date(v.createdAt), 'd MMM yyyy')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Reading history */}
              <section>
                <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest mb-3">Reading History (recent 20)</h3>
                {user.readingProgress.length === 0 ? (
                  <p className="text-[var(--fg-faint)] text-xs">No reading history.</p>
                ) : (
                  <div className="space-y-1.5">
                    {user.readingProgress.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 p-2 bg-[var(--bg)] border border-[var(--border)]">
                        <div className="flex-1 min-w-0">
                          <p className="text-[var(--fg)] text-xs line-clamp-1">{r.article.title}</p>
                          <p className="text-[var(--fg-faint)] text-[9px] mt-0.5">{formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}</p>
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <span className="text-[9px] text-[var(--fg-faint)]">{Math.round(r.progress)}%</span>
                          <div className="w-16 h-0.5 bg-[var(--border)]">
                            <div className="h-full bg-gold" style={{ width: `${r.progress}%` }} />
                          </div>
                        </div>
                        {r.completed && <span className="text-[8px] text-green-500 font-bold shrink-0">Read</span>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Activity timeline */}
              <section>
                <h3 className="text-[var(--fg)] font-bold text-xs uppercase tracking-widest mb-3">Recent Activity</h3>
                {(() => {
                  const events = [
                    ...user.articles.slice(0, 5).map((a) => ({ date: a.createdAt, type: 'article', label: `Published "${a.title}"` })),
                    ...user.comments.slice(0, 5).map((c) => ({ date: c.createdAt, type: 'comment', label: `Commented on "${c.article.title}"` })),
                    ...user.debateVotes.slice(0, 5).map((v) => ({ date: v.createdAt, type: 'vote', label: `Voted ${v.side} in "${v.debate.title}"` })),
                  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 15)

                  if (events.length === 0) return <p className="text-[var(--fg-faint)] text-xs">No activity recorded.</p>

                  return (
                    <div className="space-y-2">
                      {events.map((e, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                            e.type === 'article' ? 'bg-gold' : e.type === 'comment' ? 'bg-blue-400' : 'bg-emerald-400'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[var(--fg)] text-xs line-clamp-1">{e.label}</p>
                            <p className="text-[var(--fg-faint)] text-[9px]">{formatDistanceToNow(new Date(e.date), { addSuffix: true })}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  )
}
