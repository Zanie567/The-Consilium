'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TiptapEditor, type TiptapEditorHandle } from '@/components/editor/TiptapEditor'

interface Author {
  id: string
  name: string | null
}

interface Category {
  id: string
  name: string
}

interface Props {
  authors: Author[]
  categories: Category[]
}

export function DebateCreator({ authors, categories }: Props) {
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [closesAt, setClosesAt] = useState('')
  const [categoryId, setCategoryId] = useState('')

  // FOR side
  const [forTitle, setForTitle] = useState('')
  const [forExcerpt, setForExcerpt] = useState('')
  const [forAuthorId, setForAuthorId] = useState(authors[0]?.id ?? '')
  const [forContent, setForContent] = useState('')

  // AGAINST side
  const [againstTitle, setAgainstTitle] = useState('')
  const [againstExcerpt, setAgainstExcerpt] = useState('')
  const [againstAuthorId, setAgainstAuthorId] = useState(authors[0]?.id ?? '')
  const [againstContent, setAgainstContent] = useState('')

  const forEditorRef = useRef<TiptapEditorHandle>(null)
  const againstEditorRef = useRef<TiptapEditorHandle>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !forTitle.trim() || !againstTitle.trim() || !forContent || !againstContent) {
      setError('Please fill in all required fields and write content for both sides.')
      return
    }
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/editorial/debates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
        isActive,
        closesAt: closesAt || null,
        categoryId: categoryId || null,
        forTitle: forTitle.trim(),
        forExcerpt: forExcerpt.trim() || null,
        forAuthorId,
        forContent,
        againstTitle: againstTitle.trim(),
        againstExcerpt: againstExcerpt.trim() || null,
        againstAuthorId,
        againstContent,
      }),
    })

    setSubmitting(false)
    if (!res.ok) {
      const json = await res.json()
      setError(json.error ?? 'Failed to create debate.')
      return
    }
    router.push('/editorial/debates')
  }

  const inputCls = 'w-full bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--fg)] text-sm p-3 focus:outline-none focus:border-gold transition-colors'
  const labelCls = 'block text-[0.65rem] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-1.5'

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <button
          onClick={() => router.push('/editorial/debates')}
          className="text-[var(--fg-faint)] text-xs hover:text-gold transition-colors"
        >
          ← All Debates
        </button>
        <h1
          className="text-2xl font-bold text-[var(--fg)] mt-2"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          New Debate
        </h1>
        <p className="text-[var(--fg-muted)] text-sm mt-1">
          Create two opposing articles and link them as a debate. Both articles will be published immediately.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Debate metadata ───────────────────────────────────────────────── */}
        <section className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-6 mb-8">
          <h2 className="text-sm font-bold text-[var(--fg)] uppercase tracking-widest mb-5">Debate Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Debate Question / Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Should the UK raise the minimum wage?"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief framing of the debate shown to readers"
                className={`${inputCls} resize-none`}
              />
            </div>
            <div>
              <label className={labelCls}>Category (optional)</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={inputCls}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Closes At (optional)</label>
              <input
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3 p-4 bg-[var(--bg-subtle)] border border-[var(--border)]">
              <input
                id="isActive"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 accent-gold"
              />
              <label htmlFor="isActive" className="text-sm text-[var(--fg)] font-semibold cursor-pointer">
                Publish as active debate (shown on homepage)
              </label>
              {isActive && (
                <span className="text-[0.65rem] text-gold font-bold ml-2">
                  Any currently active debate will be deactivated.
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ── Two-panel article editors ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
          {/* FOR */}
          <section className="bg-[var(--bg-elevated)] border-t-4 border-t-navy border border-[var(--border)] shadow-[var(--shadow-card)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--border)]">
              <span className="text-navy text-[0.6rem] font-bold uppercase tracking-[0.25em]">The Case For</span>
              <h2 className="text-sm font-bold text-[var(--fg)] mt-0.5">For Article</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Article Title *</label>
                <input
                  type="text"
                  value={forTitle}
                  onChange={(e) => setForTitle(e.target.value)}
                  required
                  placeholder="Title arguing FOR the proposition"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Author *</label>
                <select
                  value={forAuthorId}
                  onChange={(e) => setForAuthorId(e.target.value)}
                  className={inputCls}
                >
                  {authors.map((a) => (
                    <option key={a.id} value={a.id}>{a.name ?? a.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Excerpt (optional)</label>
                <textarea
                  value={forExcerpt}
                  onChange={(e) => setForExcerpt(e.target.value)}
                  rows={2}
                  placeholder="Short summary shown in the debate card"
                  className={`${inputCls} resize-none`}
                />
              </div>
              <div>
                <label className={labelCls}>Article Body *</label>
                <div className="border border-[var(--border)]">
                  <TiptapEditor
                    ref={forEditorRef}
                    content={forContent}
                    onChange={setForContent}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* AGAINST */}
          <section className="bg-[var(--bg-elevated)] border-t-4 border-t-gold border border-[var(--border)] shadow-[var(--shadow-card)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--border)]">
              <span className="text-gold text-[0.6rem] font-bold uppercase tracking-[0.25em]">The Case Against</span>
              <h2 className="text-sm font-bold text-[var(--fg)] mt-0.5">Against Article</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Article Title *</label>
                <input
                  type="text"
                  value={againstTitle}
                  onChange={(e) => setAgainstTitle(e.target.value)}
                  required
                  placeholder="Title arguing AGAINST the proposition"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Author *</label>
                <select
                  value={againstAuthorId}
                  onChange={(e) => setAgainstAuthorId(e.target.value)}
                  className={inputCls}
                >
                  {authors.map((a) => (
                    <option key={a.id} value={a.id}>{a.name ?? a.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Excerpt (optional)</label>
                <textarea
                  value={againstExcerpt}
                  onChange={(e) => setAgainstExcerpt(e.target.value)}
                  rows={2}
                  placeholder="Short summary shown in the debate card"
                  className={`${inputCls} resize-none`}
                />
              </div>
              <div>
                <label className={labelCls}>Article Body *</label>
                <div className="border border-[var(--border)]">
                  <TiptapEditor
                    ref={againstEditorRef}
                    content={againstContent}
                    onChange={setAgainstContent}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Submit */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="bg-navy text-cream text-xs font-bold uppercase tracking-widest px-8 py-3 hover:bg-navy/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create Debate'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/editorial/debates')}
            className="text-xs font-semibold text-[var(--fg-faint)] hover:text-[var(--fg)] px-5 py-3 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
