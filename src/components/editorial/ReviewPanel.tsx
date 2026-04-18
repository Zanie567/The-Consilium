'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, nextFriday } from 'date-fns'
import { ArrowLeft, Star, Pin, Clock, CheckCircle, RotateCcw, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { Tooltip } from '@/components/ui/Tooltip'

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

export function ReviewPanel({ article, reviewerId, reviewerRole }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [returnNote, setReturnNote] = useState(article.editorNote ?? '')
  const [scheduledAt, setScheduledAt] = useState(
    format(nextFriday(new Date()), "yyyy-MM-dd'T'HH:mm")
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
      const d = await res.json()
      setError(d.error ?? 'Action failed.')
      setLoading(null)
      return
    }
    const data = await res.json()
    setStatus(data.status)
    setLoading(null)
    if (action === 'approve' || action === 'schedule' || action === 'unpublish') {
      router.push('/editorial')
    }
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
      const data = await res.json()
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

  const wordCount = () => {
    try {
      const parsed = JSON.parse(article.content)
      const text = JSON.stringify(parsed)
      return Math.round(text.split(/\s+/).filter(Boolean).length * 0.75)
    } catch {
      return article.content.split(/\s+/).filter(Boolean).length
    }
  }

  const statusColour: Record<string, string> = {
    DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
    PENDING_REVIEW: 'bg-amber-500/10 text-amber-600',
    PUBLISHED: 'bg-emerald-500/10 text-emerald-600',
    SCHEDULED: 'bg-blue-500/10 text-blue-600',
    REJECTED: 'bg-red-500/10 text-red-600',
    ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      {/* Back + header — on mobile add left padding to clear the hamburger */}
      <div className="flex items-start gap-3 sm:gap-4 mb-5 sm:mb-6 pl-10 md:pl-0">
        <Link
          href="/editorial/review"
          className="mt-1 text-[var(--fg-faint)] hover:text-gold transition-colors shrink-0"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1
            className="text-lg sm:text-xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {article.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-[var(--fg-faint)]">
            <span>By {article.author.name}</span>
            {article.category && <span>· {article.category.name}</span>}
            <span>· {wordCount().toLocaleString()} words</span>
            <span className={`px-2 py-0.5 font-bold ${statusColour[status] ?? ''}`}>
              {status.replace('_', ' ')}
            </span>
          </div>

          {/* Feature + Pin toggles — moved inside header div so they wrap on mobile */}
          {status === 'PUBLISHED' && (
            <div className="flex gap-2 mt-2">
              <Tooltip content={isFeatured ? 'Remove from featured: stops appearing in the homepage spotlight' : 'Set as featured: this article will appear in the main featured slot on the homepage'} variant="editorial" side="bottom" maxWidth={280}>
                <button
                  onClick={toggleFeature}
                  aria-label={isFeatured ? 'Remove featured' : 'Set as featured'}
                  className={`p-2 border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                    isFeatured
                      ? 'border-gold bg-gold/10 text-gold'
                      : 'border-[var(--border)] text-[var(--fg-faint)] hover:border-gold hover:text-gold'
                  }`}
                >
                  <Star size={16} className={isFeatured ? 'fill-gold' : ''} />
                </button>
              </Tooltip>
              <Tooltip content={isPinned ? 'Unpin from category page' : 'Pin to the top of this article\'s category page'} variant="editorial" side="bottom" maxWidth={260}>
                <button
                  onClick={togglePin}
                  aria-label={isPinned ? 'Unpin from category' : 'Pin to category page'}
                  className={`p-2 border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                    isPinned
                      ? 'border-gold bg-gold/10 text-gold'
                      : 'border-[var(--border)] text-[var(--fg-faint)] hover:border-gold hover:text-gold'
                  }`}
                >
                  <Pin size={16} className={isPinned ? 'fill-gold' : ''} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-500 bg-red-500/10 border border-red-500/20 px-4 py-3">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Article preview */}
        <div className="lg:col-span-2 bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
          <div className="px-6 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--fg-faint)] uppercase tracking-wider">
              Article Content
            </span>
            <Link
              href={`/editorial/articles/${article.id}/edit`}
              className="text-xs text-gold hover:underline"
            >
              Edit in editor →
            </Link>
          </div>
          <div
            className="p-4 sm:p-6 prose-consilium max-h-[40vh] sm:max-h-[60vh] overflow-y-auto text-sm"
            dangerouslySetInnerHTML={{ __html: renderContent(article.content) }}
          />
        </div>

        {/* Actions panel */}
        <div className="space-y-4">
          {/* Primary actions */}
          {status === 'PENDING_REVIEW' && (
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 space-y-3">
              <p className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-3">
                Review Actions
              </p>

              {/* Approve */}
              <Tooltip content="Publish this article immediately: it will appear live on the public website" variant="editorial" side="left" maxWidth={260}>
                <button
                  onClick={() => act('approve')}
                  disabled={loading !== null}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 transition-colors disabled:opacity-60 min-h-[44px]"
                >
                  <CheckCircle size={14} />
                  {loading === 'approve' ? 'Publishing…' : 'Publish Now'}
                </button>
              </Tooltip>

              {/* Schedule */}
              <div>
                <label className="block text-[var(--fg-faint)] text-xs mb-1">
                  Schedule for:
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-xs focus:outline-none focus:border-gold min-h-[44px]"
                  style={{ fontSize: 16 }}
                />
                <Tooltip content="Schedule this article to go live automatically at the chosen date and time" variant="editorial" side="left" maxWidth={260}>
                  <button
                    onClick={() => act('schedule', { scheduledAt })}
                    disabled={loading !== null}
                    className="mt-2 w-full flex items-center justify-center gap-2 bg-navy text-gold py-3 sm:py-2 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-60 min-h-[44px]"
                  >
                    <Clock size={14} />
                    {loading === 'schedule' ? 'Scheduling…' : 'Schedule'}
                  </button>
                </Tooltip>
              </div>

              {/* Return with note */}
              <div className="pt-2 border-t border-[var(--border)]">
                <label className="block text-[var(--fg-faint)] text-xs mb-1">
                  Feedback for writer:
                </label>
                <textarea
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  rows={4}
                  placeholder="What needs to be revised?"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] focus:outline-none focus:border-gold resize-none"
                  style={{ fontSize: 16 }}
                />
                <Tooltip content="Return this article to the writer with your feedback: they will be notified and can revise and resubmit" variant="editorial" side="left" maxWidth={280}>
                  <button
                    onClick={() => act('return', { note: returnNote })}
                    disabled={loading !== null || !returnNote.trim()}
                    className="mt-2 w-full flex items-center justify-center gap-2 border border-red-500/50 text-red-500 py-3 sm:py-2 text-xs font-bold uppercase tracking-widest hover:bg-red-500/10 transition-colors disabled:opacity-60 min-h-[44px]"
                  >
                    <RotateCcw size={14} />
                    {loading === 'return' ? 'Returning…' : 'Return to Writer'}
                  </button>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Unpublish (for published articles) */}
          {status === 'PUBLISHED' && (
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 space-y-3">
              <p className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
                Published Actions
              </p>

              {/* Correction toggle */}
              <div>
                <Tooltip content="Mark this article as corrected: a correction notice will appear at the top of the article on the public website" variant="editorial" side="left" maxWidth={280}>
                <label className="flex items-center gap-2 text-xs text-[var(--fg)] mb-2 cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    checked={corrected}
                    onChange={(e) => setCorrected(e.target.checked)}
                    className="accent-gold"
                  />
                  Mark as corrected
                </label>
                </Tooltip>
                <input
                  type="text"
                  value={correctionNote}
                  onChange={(e) => setCorrectionNote(e.target.value)}
                  placeholder="Correction note (optional)"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-xs focus:outline-none focus:border-gold"
                />
                <button
                  onClick={() => act('correct', { corrected, correctionNote })}
                  disabled={loading !== null}
                  className="mt-2 w-full border border-[var(--border)] text-[var(--fg-muted)] py-1.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-colors disabled:opacity-60"
                >
                  {loading === 'correct' ? 'Saving…' : 'Save Correction'}
                </button>
              </div>

              <Tooltip content="Remove this article from the public website: it returns to Draft status and can be re-published later" variant="editorial" side="left" maxWidth={280}>
                <button
                  onClick={() => act('unpublish')}
                  disabled={loading !== null}
                  className="w-full flex items-center justify-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] py-2 text-xs font-bold uppercase tracking-widest hover:border-red-500 hover:text-red-500 transition-colors disabled:opacity-60"
                >
                  <EyeOff size={14} />
                  {loading === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
                </button>
              </Tooltip>
            </div>
          )}

          {/* Editor note to writer */}
          {article.editorNote && (
            <div className="bg-amber-500/10 border border-amber-500/20 p-4">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">
                Editor Note
              </p>
              <p className="text-xs text-[var(--fg-muted)]">{article.editorNote}</p>
            </div>
          )}

          {/* Notes thread */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4">
            <p className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-3">
              Internal Notes
            </p>
            {notes.length > 0 && (
              <div className="space-y-3 mb-3 max-h-48 overflow-y-auto">
                {notes.map((n) => (
                  <div key={n.id} className="text-xs">
                    <p className="font-semibold text-[var(--fg)]">{n.author.name}</p>
                    <p className="text-[var(--fg-muted)] mt-0.5">{n.content}</p>
                    <p className="text-[var(--fg-faint)] mt-1">
                      {format(new Date(n.createdAt), 'd MMM, HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()}
                placeholder="Add internal note…"
                className="flex-1 bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] focus:outline-none focus:border-gold min-h-[44px]"
                style={{ fontSize: 16 }}
              />
              <button
                onClick={addNote}
                disabled={!note.trim() || loading === 'note'}
                className="bg-navy text-gold px-3 py-2 text-xs font-bold hover:bg-navy-dark transition-colors disabled:opacity-60 min-h-[44px] min-w-[44px]"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function renderContent(content: string): string {
  try {
    const parsed = JSON.parse(content)
    if (parsed?.type === 'doc') return tiptapToHtml(parsed)
  } catch {}
  return content
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
    case 'heading': return `<h${node.attrs?.level ?? 2}>${(node.content ?? []).map(nodeToHtml).join('')}</h${node.attrs?.level ?? 2}>`
    case 'text': {
      let t = node.text ?? ''
      for (const m of node.marks ?? []) {
        if (m.type === 'bold') t = `<strong>${t}</strong>`
        if (m.type === 'italic') t = `<em>${t}</em>`
        if (m.type === 'underline') t = `<u>${t}</u>`
        if (m.type === 'highlight') t = `<mark>${t}</mark>`
        if (m.type === 'link') t = `<a href="${m.attrs?.href ?? '#'}">${t}</a>`
      }
      return t
    }
    case 'bulletList': return `<ul>${(node.content ?? []).map(nodeToHtml).join('')}</ul>`
    case 'orderedList': return `<ol>${(node.content ?? []).map(nodeToHtml).join('')}</ol>`
    case 'listItem': return `<li>${(node.content ?? []).map(nodeToHtml).join('')}</li>`
    case 'blockquote': return `<blockquote>${(node.content ?? []).map(nodeToHtml).join('')}</blockquote>`
    case 'horizontalRule': return '<hr />'
    case 'image': return `<img src="${node.attrs?.src ?? ''}" alt="${node.attrs?.alt ?? ''}" />`
    case 'hardBreak': return '<br />'
    default: return (node.content ?? []).map(nodeToHtml).join('')
  }
}
