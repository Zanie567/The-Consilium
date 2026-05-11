'use client'

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { format, nextFriday } from 'date-fns'
import { ArrowLeft, CheckCircle, Clock, EyeOff, MessageSquarePlus, Pin, RotateCcw, Star } from 'lucide-react'
import Link from 'next/link'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  EDITORIAL_TIME_ZONE_LABEL,
  formatEditorialScheduleInput,
  getEditorialScheduleMinInput,
} from '@/lib/editorialSchedule'

interface Note {
  id: string
  content: string
  isPrivate: boolean
  createdAt: string
  author: { name: string | null }
}

interface ReviewCommentReply {
  id: string
  body: string
  createdAt: string
  author: { id: string; name: string | null }
}

interface ReviewCommentThread {
  id: string
  articleId: string
  anchorText: string
  selectedText: string
  resolved: boolean
  createdAt: string
  replies: ReviewCommentReply[]
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
  const [threads, setThreads] = useState<ReviewCommentThread[]>([])
  const [selectedText, setSelectedText] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [showResolved, setShowResolved] = useState(false)

  useEffect(() => {
    fetch(`/api/editorial/review-comments?articleId=${article.id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setThreads(data as ReviewCommentThread[])
      })
      .catch(() => setThreads([]))
  }, [article.id])

  const activeThreads = threads.filter((thread) => !thread.resolved)
  const resolvedThreads = threads.filter((thread) => thread.resolved)
  const renderedArticle = useMemo(
    () => highlightComments(renderContent(article.content), activeThreads),
    [article.content, activeThreads]
  )

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

  const captureSelection = () => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    if (text.length > 1) setSelectedText(text.slice(0, 500))
  }

  const addThread = async () => {
    if (!selectedText || !commentBody.trim()) return
    setLoading('comment')
    const res = await fetch('/api/editorial/review-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articleId: article.id,
        selectedText,
        anchorText: selectedText,
        body: commentBody,
      }),
    })
    if (res.ok) {
      const thread = (await res.json()) as ReviewCommentThread
      setThreads((prev) => [...prev, thread])
      setSelectedText('')
      setCommentBody('')
    } else {
      setError('Review comments need the manual SQL installed before they can be saved.')
    }
    setLoading(null)
  }

  const addReply = async (threadId: string) => {
    const body = replyDrafts[threadId]?.trim()
    if (!body) return
    setLoading(`reply-${threadId}`)
    const res = await fetch('/api/editorial/review-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, body }),
    })
    if (res.ok) {
      const reply = (await res.json()) as ReviewCommentReply
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId ? { ...thread, replies: [...thread.replies, reply] } : thread
        )
      )
      setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }))
    }
    setLoading(null)
  }

  const setResolved = async (threadId: string, resolved: boolean) => {
    const res = await fetch('/api/editorial/review-comments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, resolved }),
    })
    if (res.ok) {
      setThreads((prev) => prev.map((thread) => (thread.id === threadId ? { ...thread, resolved } : thread)))
    }
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

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--fg-faint)]">Article Preview</p>
                <p className="mt-1 text-xs text-[var(--fg-faint)]">Select text to anchor a review comment.</p>
              </div>
              <Link href={`/editorial/articles/${article.id}/edit`} className="text-xs font-bold uppercase tracking-widest text-gold hover:underline">
                Edit in editor
              </Link>
            </div>
            <article
              onMouseUp={captureSelection}
              className="prose-consilium mx-auto min-h-[70vh] max-w-[820px] px-6 py-10 text-[var(--fg)] sm:px-10 lg:px-14"
              dangerouslySetInnerHTML={{ __html: renderedArticle }}
            />
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            {selectedText && (
              <Panel title="New Comment" icon={<MessageSquarePlus size={14} />}>
                <p className="mb-3 border-l-2 border-gold bg-gold/10 px-3 py-2 text-xs italic text-[var(--fg-muted)]">
                  {selectedText}
                </p>
                <textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  rows={4}
                  placeholder="Add an editorial comment..."
                  className="w-full resize-none border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold"
                />
                <button onClick={addThread} disabled={loading === 'comment' || !commentBody.trim()} className="mt-3 w-full bg-navy px-4 py-3 text-xs font-bold uppercase tracking-widest text-gold disabled:opacity-60">
                  Save Comment
                </button>
              </Panel>
            )}

            {status === 'PENDING_REVIEW' && (
              <Panel title="Review Actions">
                <button onClick={() => act('approve')} disabled={loading !== null} className="flex min-h-[44px] w-full items-center justify-center gap-2 bg-emerald-600 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-60">
                  <CheckCircle size={14} />
                  {loading === 'approve' ? 'Publishing...' : 'Publish Now'}
                </button>
                <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
                  Schedule for {EDITORIAL_TIME_ZONE_LABEL}
                </label>
                <input type="datetime-local" value={scheduledAt} min={getEditorialScheduleMinInput()} onChange={(event) => setScheduledAt(event.target.value)} className="mt-2 min-h-[44px] w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold" />
                <button onClick={() => act('schedule', { scheduledAt })} disabled={loading !== null} className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 bg-navy px-4 py-3 text-xs font-bold uppercase tracking-widest text-gold disabled:opacity-60">
                  <Clock size={14} />
                  {loading === 'schedule' ? 'Scheduling...' : 'Schedule'}
                </button>
                <label className="mt-5 block text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
                  Feedback for writer
                </label>
                <textarea value={returnNote} onChange={(event) => setReturnNote(event.target.value)} rows={5} placeholder="What needs to be revised?" className="mt-2 w-full resize-none border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold" />
                <button onClick={() => act('return', { note: returnNote })} disabled={loading !== null || !returnNote.trim()} className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 border border-red-500/50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-red-500 disabled:opacity-60">
                  <RotateCcw size={14} />
                  {loading === 'return' ? 'Returning...' : 'Return to Writer'}
                </button>
              </Panel>
            )}

            {status === 'PUBLISHED' && (
              <Panel title="Published Actions">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--fg)]">
                  <input type="checkbox" checked={corrected} onChange={(event) => setCorrected(event.target.checked)} className="accent-gold" />
                  Mark as corrected
                </label>
                <input value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} placeholder="Correction note" className="mt-3 w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold" />
                <button onClick={() => act('correct', { corrected, correctionNote })} disabled={loading !== null} className="mt-3 w-full border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] disabled:opacity-60">
                  Save Correction
                </button>
                <button onClick={() => act('unpublish')} disabled={loading !== null} className="mt-3 flex w-full items-center justify-center gap-2 border border-red-500/40 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-500 disabled:opacity-60">
                  <EyeOff size={14} />
                  Unpublish
                </button>
              </Panel>
            )}

            <Panel title={`Comments ${activeThreads.length ? `(${activeThreads.length})` : ''}`}>
              <CommentList threads={activeThreads} replyDrafts={replyDrafts} setReplyDrafts={setReplyDrafts} addReply={addReply} setResolved={setResolved} loading={loading} />
              <button onClick={() => setShowResolved((value) => !value)} className="mt-4 text-xs font-bold uppercase tracking-widest text-gold">
                {showResolved ? 'Hide Resolved' : `Resolved (${resolvedThreads.length})`}
              </button>
              {showResolved && <CommentList threads={resolvedThreads} replyDrafts={replyDrafts} setReplyDrafts={setReplyDrafts} addReply={addReply} setResolved={setResolved} loading={loading} />}
            </Panel>

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
                <input value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addNote()} placeholder="Add internal note..." className="min-h-[44px] flex-1 border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold" />
                <button onClick={addNote} disabled={!note.trim() || loading === 'note'} className="min-h-[44px] bg-navy px-3 py-2 text-xs font-bold text-gold disabled:opacity-60">
                  Add
                </button>
              </div>
            </Panel>
          </aside>
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

function CommentList({
  threads,
  replyDrafts,
  setReplyDrafts,
  addReply,
  setResolved,
  loading,
}: {
  threads: ReviewCommentThread[]
  replyDrafts: Record<string, string>
  setReplyDrafts: Dispatch<SetStateAction<Record<string, string>>>
  addReply: (threadId: string) => void
  setResolved: (threadId: string, resolved: boolean) => void
  loading: string | null
}) {
  if (threads.length === 0) return <p className="text-sm text-[var(--fg-faint)]">No comments in this view.</p>

  return (
    <div className="space-y-4">
      {threads.map((thread) => (
        <div key={thread.id} className="border-l-2 border-gold bg-gold/5 p-3">
          <p className="mb-3 text-xs italic text-[var(--fg-muted)]">{thread.selectedText}</p>
          <div className="space-y-3">
            {thread.replies.map((reply) => (
              <div key={reply.id} className="text-sm">
                <p className="font-semibold text-[var(--fg)]">{reply.author.name ?? 'Editor'}</p>
                <p className="mt-1 text-[var(--fg-muted)]">{reply.body}</p>
                <p className="mt-1 text-[10px] text-[var(--fg-faint)]">{format(new Date(reply.createdAt), 'd MMM, HH:mm')}</p>
              </div>
            ))}
          </div>
          <input value={replyDrafts[thread.id] ?? ''} onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: event.target.value }))} placeholder="Reply..." className="mt-3 min-h-[40px] w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-gold" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button onClick={() => addReply(thread.id)} disabled={loading === `reply-${thread.id}` || !replyDrafts[thread.id]?.trim()} className="text-xs font-bold uppercase tracking-widest text-gold disabled:opacity-50">
              Reply
            </button>
            <button onClick={() => setResolved(thread.id, !thread.resolved)} className="text-xs font-bold uppercase tracking-widest text-[var(--fg-faint)] hover:text-gold">
              {thread.resolved ? 'Reopen' : 'Resolve'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function renderContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { type?: string; content?: TNode[] }
    if (parsed.type === 'doc') return tiptapToHtml({ type: 'doc', content: parsed.content })
  } catch {}
  return escapeHtml(content)
}

function tiptapToHtml(doc: { type: string; content?: TNode[] }): string {
  return (doc.content ?? []).map(nodeToHtml).join('')
}

interface TNode {
  type: string
  content?: TNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  attrs?: Record<string, unknown>
}

function nodeToHtml(node: TNode): string {
  switch (node.type) {
    case 'paragraph': return `<p>${(node.content ?? []).map(nodeToHtml).join('')}</p>`
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2
      return `<h${level}>${(node.content ?? []).map(nodeToHtml).join('')}</h${level}>`
    }
    case 'text': {
      let text = escapeHtml(node.text ?? '')
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') text = `<strong>${text}</strong>`
        if (mark.type === 'italic') text = `<em>${text}</em>`
        if (mark.type === 'underline') text = `<u>${text}</u>`
        if (mark.type === 'highlight') text = `<mark>${text}</mark>`
        if (mark.type === 'link') text = `<a href="${escapeAttribute(String(mark.attrs?.href ?? '#'))}">${text}</a>`
      }
      return text
    }
    case 'bulletList': return `<ul>${(node.content ?? []).map(nodeToHtml).join('')}</ul>`
    case 'orderedList': return `<ol>${(node.content ?? []).map(nodeToHtml).join('')}</ol>`
    case 'listItem': return `<li>${(node.content ?? []).map(nodeToHtml).join('')}</li>`
    case 'blockquote': return `<blockquote>${(node.content ?? []).map(nodeToHtml).join('')}</blockquote>`
    case 'horizontalRule': return '<hr />'
    case 'figure': return `<figure><img src="${escapeAttribute(String(node.attrs?.src ?? ''))}" alt="${escapeAttribute(String(node.attrs?.alt ?? ''))}" /></figure>`
    case 'image': return `<img src="${escapeAttribute(String(node.attrs?.src ?? ''))}" alt="${escapeAttribute(String(node.attrs?.alt ?? ''))}" />`
    case 'hardBreak': return '<br />'
    default: return (node.content ?? []).map(nodeToHtml).join('')
  }
}

function highlightComments(html: string, threads: ReviewCommentThread[]): string {
  let output = html
  for (const thread of threads) {
    const needle = escapeHtml(thread.selectedText)
    if (!needle || !output.includes(needle)) continue
    output = output.replace(
      needle,
      `<mark class="bg-gold/20 text-inherit ring-1 ring-gold/40" data-review-comment="${escapeAttribute(thread.id)}">${needle}</mark>`
    )
  }
  return output
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;')
}
