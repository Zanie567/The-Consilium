'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { format, nextFriday } from 'date-fns'
import { ArrowLeft, Star, Pin, Clock, CheckCircle, RotateCcw, EyeOff, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  EDITORIAL_TIME_ZONE_LABEL,
  formatEditorialScheduleInput,
  getEditorialScheduleMinInput,
} from '@/lib/editorialSchedule'
import { CommentsPanel, type ArticleComment } from '@/components/editorial/CommentsPanel'
import { ArticlePreviewWithComments } from '@/components/editorial/ArticlePreviewWithComments'

interface Note {
  id: string
  content: string
  isPrivate: boolean
  createdAt: string
  author: { name: string | null }
}

interface Article {
  id: string
  title: string
  content: string
  excerpt: string | null
  status: string
  isFeatured: boolean
  isPinned: boolean
  corrected: boolean
  correctionNote: string | null
  editorNote: string | null
  scheduledAt: string | null
  publishedAt: string | null
  author: { id: string; name: string | null; email: string | null }
  category: { id: string; name: string; slug: string } | null
  notes: Note[]
}

interface Props {
  article: Article
  reviewerId: string
  reviewerRole: string
}

export function ReviewPanel({ article }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [comments, setComments] = useState<ArticleComment[]>([])
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentsTab, setCommentsTab] = useState<'actions' | 'comments'>('actions')

  useEffect(() => {
    fetch(`/api/articles/${article.id}/comments`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: ArticleComment[]) => setComments(data))
      .catch(() => {})
  }, [article.id])

  const [returnNote, setReturnNote] = useState(article.editorNote ?? '')
  const [scheduledAt, setScheduledAt] = useState(
    formatEditorialScheduleInput(article.scheduledAt ?? nextFriday(new Date()))
  )
  const [corrected, setCorrected] = useState(article.corrected)
  const [correctionNote, setCorrectionNote] = useState(article.correctionNote ?? '')
  const [isFeatured, setIsFeatured] = useState(article.isFeatured)
  const [isPinned, setIsPinned] = useState(article.isPinned)
  const [notes, setNotes] = useState<Note[]>(article.notes)
  const [status, setStatus] = useState(article.status)
  const [error, setError] = useState('')

  const act = async (action: string, extra?: Record<string, unknown>) => {
    setLoading(action)
    setError('')
    const res = await fetch(`/api/editorial/articles/${article.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({ error: 'Action failed.' }))
      setError(typeof d.error === 'string' ? d.error : 'Action failed.')
      setLoading(null)
      return
    }
    const data = (await res.json()) as { status?: string }
    if (data.status) setStatus(data.status)
    setLoading(null)
    if (action === 'approve' || action === 'schedule' || action === 'unpublish') router.push('/editorial')
  }

  const addNote = async () => {
    if (!note.trim()) return
    setLoading('note')
    const res = await fetch(`/api/articles/${article.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: note }),
    })
    if (res.ok) {
      const data = (await res.json()) as Note
      setNotes((prev) => [...prev, data])
      setNote('')
    }
    setLoading(null)
  }

  const toggleFeature = async () => {
    const method = isFeatured ? 'DELETE' : 'POST'
    const res = await fetch(`/api/editorial/articles/${article.id}/feature`, { method })
    if (res.ok) setIsFeatured(!isFeatured)
  }

  const togglePin = async () => {
    const method = isPinned ? 'DELETE' : 'POST'
    const res = await fetch(`/api/editorial/articles/${article.id}/pin`, { method })
    if (res.ok) setIsPinned(!isPinned)
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-6 flex items-start gap-4 pl-10 md:pl-0">
          <Link href="/editorial/review" className="mt-1 text-[var(--fg-faint)] hover:text-gold">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gold/70">Review Studio</p>
            <h1 className="text-2xl font-bold leading-tight text-[var(--fg)] sm:text-3xl" style={{ fontFamily: 'var(--font-serif)' }}>
              {article.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--fg-faint)]">
              <span>By {article.author.name}</span>
              {article.category && <span>{article.category.name}</span>}
              <StatusPill status={status} />
            </div>
          </div>
          {status === 'PUBLISHED' && (
            <div className="hidden gap-2 sm:flex">
              <IconToggle active={isFeatured} label="Featured" onClick={toggleFeature} icon={<Star size={16} />} />
              <IconToggle active={isPinned} label="Pinned" onClick={togglePin} icon={<Pin size={16} />} />
            </div>
          )}
        </header>

        {error && <p className="mb-4 border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
          {/* Article preview with inline commenting - full height, page scrolls */}
          <div className="lg:col-span-2 bg-[var(--bg-elevated)] border border-[var(--border)]">
            <div className="px-4 sm:px-6 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--fg-faint)] uppercase tracking-wider">
                Article Content
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-[var(--fg-faint)] hidden sm:block">
                  Select text to comment
                </span>
                <Link
                  href={`/editorial/articles/${article.id}/edit`}
                  className="text-xs text-gold hover:underline"
                >
                  Edit →
                </Link>
              </div>
            </div>
            <div className="p-4 sm:p-6 prose-consilium text-sm">
              <ArticlePreviewWithComments
                content={article.content}
                articleId={article.id}
                comments={comments}
                activeCommentId={activeCommentId}
                onCommentCreated={(c) => {
                  setComments((prev) => [...prev, c])
                  setCommentsTab('comments')
                }}
                onSelectComment={setActiveCommentId}
              />
            </div>
          </div>

          {/* Actions + comments right panel - sticky so it stays visible while reading */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {/* Tab bar */}
            <div className="flex border border-[var(--border)] bg-[var(--bg-elevated)]">
              <button
                onClick={() => setCommentsTab('actions')}
                className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${commentsTab === 'actions' ? 'bg-navy text-gold' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]'}`}
              >
                Review
              </button>
              <button
                onClick={() => setCommentsTab('comments')}
                className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-1.5 ${commentsTab === 'comments' ? 'bg-navy text-gold' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]'}`}
              >
                <MessageSquare size={12} />
                Comments
                {comments.filter((c) => !c.resolved && !c.parentId).length > 0 && (
                  <span className="bg-gold text-navy text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                    {comments.filter((c) => !c.resolved && !c.parentId).length}
                  </span>
                )}
              </button>
            </div>

            {commentsTab === 'comments' ? (
              <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
                <CommentsPanel
                  articleId={article.id}
                  comments={comments}
                  onCommentResolved={(id, resolved) => {
                    setComments((prev) => prev.map((c) => c.id === id ? { ...c, resolved } : c))
                  }}
                  onCommentAdded={(c) => setComments((prev) => [...prev, c])}
                  activeCommentId={activeCommentId}
                  onSelectComment={setActiveCommentId}
                />
              </div>
            ) : (
              <div className="space-y-4">
                {status === 'PENDING_REVIEW' && (
                  <Panel title="Review Actions">
                    <Tooltip content="Publish this article immediately: it will appear live on the public website" variant="editorial" side="left" maxWidth={260}>
                      <button
                        onClick={() => act('approve')}
                        disabled={loading !== null}
                        className="flex min-h-[44px] w-full items-center justify-center gap-2 bg-emerald-600 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-60 hover:bg-emerald-700 transition-colors"
                      >
                        <CheckCircle size={14} />
                        {loading === 'approve' ? 'Publishing...' : 'Publish Now'}
                      </button>
                    </Tooltip>
                    <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
                      Schedule for {EDITORIAL_TIME_ZONE_LABEL}
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      min={getEditorialScheduleMinInput()}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="mt-2 min-h-[44px] w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold"
                    />
                    <button
                      onClick={() => act('schedule', { scheduledAt })}
                      disabled={loading !== null}
                      className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 bg-navy px-4 py-3 text-xs font-bold uppercase tracking-widest text-gold disabled:opacity-60"
                    >
                      <Clock size={14} />
                      {loading === 'schedule' ? 'Scheduling...' : 'Schedule'}
                    </button>
                    <label className="mt-5 block text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
                      Feedback for writer
                    </label>
                    <textarea
                      value={returnNote}
                      onChange={(e) => setReturnNote(e.target.value)}
                      rows={5}
                      placeholder="What needs to be revised?"
                      className="mt-2 w-full resize-none border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold"
                    />
                    <button
                      onClick={() => act('return', { note: returnNote })}
                      disabled={loading !== null || !returnNote.trim()}
                      className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 border border-red-500/50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-red-500 disabled:opacity-60"
                    >
                      <RotateCcw size={14} />
                      {loading === 'return' ? 'Returning...' : 'Return to Writer'}
                    </button>
                  </Panel>
                )}

                {status === 'PUBLISHED' && (
                  <Panel title="Published Actions">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--fg)]">
                      <input
                        type="checkbox"
                        checked={corrected}
                        onChange={(e) => setCorrected(e.target.checked)}
                        className="accent-gold"
                      />
                      Mark as corrected
                    </label>
                    <input
                      value={correctionNote}
                      onChange={(e) => setCorrectionNote(e.target.value)}
                      placeholder="Correction note"
                      className="mt-3 w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold"
                    />
                    <button
                      onClick={() => act('correct', { corrected, correctionNote })}
                      disabled={loading !== null}
                      className="mt-3 w-full border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] disabled:opacity-60"
                    >
                      Save Correction
                    </button>
                    <button
                      onClick={() => act('unpublish')}
                      disabled={loading !== null}
                      className="mt-3 flex w-full items-center justify-center gap-2 border border-red-500/40 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-500 disabled:opacity-60"
                    >
                      <EyeOff size={14} />
                      Unpublish
                    </button>
                  </Panel>
                )}

                {article.editorNote && (
                  <Panel title="Editor Note">
                    <p className="text-sm text-[var(--fg-muted)]">{article.editorNote}</p>
                  </Panel>
                )}

                <Panel title="Internal Notes">
                  {notes.length > 0 && (
                    <div className="mb-3 max-h-48 space-y-3 overflow-y-auto">
                      {notes.map((item) => (
                        <div key={item.id} className="text-xs">
                          <p className="font-semibold text-[var(--fg)]">{item.author.name}</p>
                          <p className="mt-1 text-[var(--fg-muted)]">{item.content}</p>
                          <p className="mt-1 text-[var(--fg-faint)]">{format(new Date(item.createdAt), 'd MMM, HH:mm')}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addNote()}
                      placeholder="Add internal note..."
                      className="min-h-[44px] flex-1 border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold"
                    />
                    <button
                      onClick={addNote}
                      disabled={!note.trim() || loading === 'note'}
                      className="min-h-[44px] bg-navy px-3 py-2 text-xs font-bold text-gold disabled:opacity-60"
                    >
                      Add
                    </button>
                  </div>
                </Panel>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--fg)]">
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

function IconToggle({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip content={label} variant="editorial" side="bottom">
      <button onClick={onClick} className={`flex min-h-[44px] min-w-[44px] items-center justify-center border ${active ? 'border-gold bg-gold/10 text-gold' : 'border-[var(--border)] text-[var(--fg-faint)] hover:text-gold'}`}>
        {icon}
      </button>
    </Tooltip>
  )
}

function StatusPill({ status }: { status: string }) {
  const statusClass: Record<string, string> = {
    DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
    PENDING_REVIEW: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    PUBLISHED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    REJECTED: 'bg-red-500/10 text-red-600 dark:text-red-400',
    ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
  }
  return <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${statusClass[status] ?? ''}`}>{status.replace('_', ' ')}</span>
}
