'use client'

import React, { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Save, Send, Eye, X, Tag, ArrowLeft, Check, AlertCircle,
  ImagePlus, Loader2, ChevronDown, FileUp,
} from 'lucide-react'
import slugify from 'slugify'
import { BlockSidebar } from '@/components/editor/BlockSidebar'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="h-[500px] bg-[var(--bg-subtle)] animate-pulse" /> }
) as React.ForwardRefExoticComponent<
  { content?: string; onChange: (content: string) => void; editable?: boolean } &
  React.RefAttributes<TiptapEditorHandle>
>

interface Category {
  id: string
  name: string
  slug: string
}

interface ArticleEditorProps {
  articleId?: string
  initialData?: {
    title: string
    slug: string
    content: string
    excerpt: string
    coverImage: string
    categoryId: string
    status: string
    editorNote?: string | null
    tags?: string[]
  }
  categories: Category[]
  authorId: string
  canPublish: boolean
  returnUrl?: string
  isWriter?: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending Review',
  PUBLISHED: 'Published',
  SCHEDULED: 'Scheduled',
  ARCHIVED: 'Archived',
  REJECTED: 'Returned',
}

const STATUS_COLOURS: Record<string, string> = {
  DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] border-[var(--border)]',
  PENDING_REVIEW: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  SCHEDULED: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)] border-[var(--border)]',
  REJECTED: 'bg-red-500/10 text-red-600 border-red-500/20',
}

export function ArticleEditor({
  articleId,
  initialData,
  categories,
  authorId,
  canPublish,
  returnUrl,
  isWriter,
}: ArticleEditorProps) {
  const router = useRouter()
  const [title, setTitle] = useState(initialData?.title ?? '')
  const [slug, setSlug] = useState(initialData?.slug ?? '')
  const [content, setContent] = useState(initialData?.content ?? '')
  const [excerpt, setExcerpt] = useState(initialData?.excerpt ?? '')
  const [coverImage, setCoverImage] = useState(initialData?.coverImage ?? '')
  const [categoryId, setCategoryId] = useState(initialData?.categoryId ?? '')
  const [status, setStatus] = useState(initialData?.status ?? 'DRAFT')
  const [scheduledAt, setScheduledAt] = useState('')
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [uploading, setUploading] = useState(false)
  const [coverDragOver, setCoverDragOver] = useState(false)
  const [error, setError] = useState('')
  const [coverError, setCoverError] = useState('')

  const titleRef = useRef<HTMLTextAreaElement>(null)
  const excerptRef = useRef<HTMLTextAreaElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)
  const pdfFileRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<TiptapEditorHandle | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hasMounted = useRef(false)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [pdfImporting, setPdfImporting] = useState(false)
  const [pdfError, setPdfError] = useState('')

  const currentStatus = initialData?.status ?? 'DRAFT'
  const canEdit = !isWriter || currentStatus === 'DRAFT' || currentStatus === 'REJECTED'

  // Auto-resize title textarea
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [title])

  // Auto-resize excerpt textarea
  useEffect(() => {
    const el = excerptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [excerpt])

  // Auto-save for existing articles (debounced)
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return }
    if (!articleId || !canEdit) return
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => { silentSave() }, 2500)
    return () => clearTimeout(autoSaveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, excerpt, coverImage, categoryId, tags, slug])

  const handleTitleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setTitle(val)
    if (!articleId) {
      setSlug(slugify(val, { lower: true, strict: true, trim: true }))
    }
  }

  const handleContentChange = useCallback((c: string) => setContent(c), [])

  const addTag = (raw: string) => {
    const name = raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    if (name && !tags.includes(name) && tags.length < 10) {
      setTags((prev) => [...prev, name])
    }
    setTagInput('')
  }

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

  const uploadCoverFile = async (file: File) => {
    setUploading(true)
    setCoverError('')
    const form = new FormData()
    form.append('file', file)
    form.append('bucket', 'article-images')
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok) {
        setCoverImage(data.url)
      } else {
        setCoverError(data.error ?? 'Upload failed. Ensure image storage is configured in Vercel env vars.')
      }
    } catch {
      setCoverError('Upload failed. Check your connection.')
    } finally {
      setUploading(false)
    }
  }

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadCoverFile(file)
    e.target.value = ''
  }

  const buildBody = (overrideStatus?: string) => {
    const finalStatus = overrideStatus ?? status
    return {
      title, slug, content, excerpt,
      coverImage: coverImage || null,
      categoryId: categoryId || null,
      authorId,
      status: finalStatus,
      tags,
      ...(finalStatus === 'SCHEDULED' && scheduledAt ? { scheduledAt } : {}),
    }
  }

  const silentSave = async () => {
    if (!title.trim() || !articleId) return
    setSaveStatus('saving')
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      })
      if (res.ok) {
        setSaveStatus('saved')
        clearTimeout(savedTimeoutRef.current)
        savedTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
  }

  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPdfError('')
    setPdfImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) { setPdfError(data.error ?? 'PDF import failed.'); return }
      if (editorRef.current && data.text) {
        editorRef.current.insertTextAsContent(data.text)
      }
    } catch {
      setPdfError('Failed to import PDF.')
    } finally {
      setPdfImporting(false)
      if (pdfFileRef.current) pdfFileRef.current.value = ''
    }
  }

  const handleSave = async (overrideStatus?: string) => {
    if (!title.trim()) { setError('A title is required.'); return }
    const finalStatus = overrideStatus ?? status
    if (finalStatus === 'SCHEDULED' && !scheduledAt) {
      setError('Please pick a future date and time to schedule this article.')
      return
    }
    if (finalStatus === 'SCHEDULED' && scheduledAt && new Date(scheduledAt) <= new Date()) {
      setError('Scheduled date must be in the future.')
      return
    }
    setSaveStatus('saving')
    setError('')

    try {
      const res = articleId
        ? await fetch(`/api/articles/${articleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(overrideStatus)),
          })
        : await fetch('/api/articles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(overrideStatus)),
          })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save.')
        setSaveStatus('error')
        return
      }

      const saved = await res.json()
      setSaveStatus('saved')
      clearTimeout(savedTimeoutRef.current)
      savedTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 3000)

      if (!articleId) {
        router.push(returnUrl ? `${returnUrl}/${saved.id}/edit` : `/editorial/articles/${saved.id}/edit`)
      } else {
        if (overrideStatus) setStatus(overrideStatus)
        router.refresh()
      }
    } catch {
      setError('Network error. Please try again.')
      setSaveStatus('error')
    }
  }

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Sticky action bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-[var(--bg)] border-b border-[var(--border)] flex items-center justify-between gap-4 px-5 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href={returnUrl ?? '/editorial'}
            className="text-[var(--fg-faint)] hover:text-gold transition-colors shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </a>

          {/* Status badge */}
          <span className={`hidden sm:inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border ${STATUS_COLOURS[status] ?? STATUS_COLOURS.DRAFT}`}>
            {STATUS_LABELS[status] ?? status}
          </span>

          {/* Truncated title preview */}
          <span className="text-[var(--fg-muted)] text-sm truncate min-w-0 hidden md:block">
            {title || 'Untitled'}
          </span>
        </div>

        {/* Auto-save indicator + actions */}
        <div className="flex items-center gap-2 shrink-0">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-[var(--fg-faint)] text-xs">
              <Loader2 size={11} className="animate-spin" />
              Saving
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-emerald-500 text-xs">
              <Check size={11} />
              Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1.5 text-red-500 text-xs">
              <AlertCircle size={11} />
              Save failed
            </span>
          )}

          {articleId && status === 'PUBLISHED' && (
            <a
              href={`/articles/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[var(--fg-muted)] text-xs px-3 py-1.5 border border-[var(--border)] hover:border-gold hover:text-gold transition-colors"
            >
              <Eye size={12} />
              <span className="hidden sm:inline">View live</span>
            </a>
          )}

          {canEdit && (
            <button
              onClick={() => handleSave()}
              disabled={saveStatus === 'saving'}
              className="inline-flex items-center gap-1.5 text-[var(--fg-muted)] text-xs px-3 py-1.5 border border-[var(--border)] hover:border-gold hover:text-gold transition-colors disabled:opacity-50"
            >
              <Save size={12} />
              <span className="hidden sm:inline">Save draft</span>
            </button>
          )}

          {canPublish && canEdit && (
            <button
              onClick={() => handleSave(status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')}
              disabled={saveStatus === 'saving'}
              className="inline-flex items-center gap-1.5 bg-navy text-gold text-xs font-bold uppercase tracking-widest px-4 py-1.5 hover:bg-navy/80 transition-colors disabled:opacity-50"
            >
              <Send size={12} />
              {status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
            </button>
          )}

          {isWriter && (currentStatus === 'DRAFT' || currentStatus === 'REJECTED') && (
            <button
              onClick={() => handleSave('PENDING_REVIEW')}
              disabled={saveStatus === 'saving'}
              className="inline-flex items-center gap-1.5 bg-amber-600 text-white text-xs font-bold uppercase tracking-widest px-4 py-1.5 hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              <Send size={12} />
              Submit
            </button>
          )}
        </div>
      </div>

      {/* ── Banners ───────────────────────────────────────────────────────── */}
      {initialData?.editorNote && (
        <div className="mx-6 mt-5 bg-amber-500/8 border border-amber-500/20 px-5 py-4">
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1.5">
            Editor feedback
          </p>
          <p className="text-sm text-[var(--fg-muted)] leading-relaxed">{initialData.editorNote}</p>
        </div>
      )}

      {error && (
        <div className="mx-6 mt-5 flex items-start gap-2 bg-red-500/8 border border-red-500/20 px-4 py-3 text-red-500 text-sm">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {!canEdit && (
        <div className="mx-6 mt-5 bg-[var(--bg-subtle)] border border-[var(--border)] px-4 py-3 text-[var(--fg-muted)] text-sm">
          This article is under review and cannot be edited until an editor responds.
        </div>
      )}

      {/* ── Main layout ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-0">

        {/* Writing column */}
        <div className="flex-1 min-w-0 px-6 lg:px-10 py-8 space-y-0">

          {/* Cover image upload zone */}
          <div className="mb-8">
            <input
              ref={coverFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCoverUpload}
            />

            {coverError && (
              <div className="mb-2 text-xs text-red-500 bg-red-500/8 border border-red-500/20 px-3 py-2">
                {coverError}
              </div>
            )}

            {coverImage ? (
              <div
                className={`relative group aspect-video w-full overflow-hidden bg-[var(--bg-subtle)] ${
                  coverDragOver ? 'ring-2 ring-gold' : ''
                }`}
                onDragOver={(e) => { e.preventDefault(); setCoverDragOver(true) }}
                onDragLeave={() => setCoverDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setCoverDragOver(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) uploadCoverFile(file)
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImage}
                  alt="Cover"
                  className="w-full h-full object-cover"
                  onError={(e) => { ;(e.target as HTMLImageElement).style.display = 'none' }}
                />
                {canEdit && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => coverFileRef.current?.click()}
                      className="flex items-center gap-2 text-white text-xs font-semibold bg-black/40 border border-white/20 px-4 py-2 hover:bg-black/60 transition-colors"
                    >
                      <ImagePlus size={13} />
                      {uploading ? 'Uploading...' : 'Change cover'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCoverImage('')}
                      className="flex items-center gap-2 text-white/70 text-xs bg-black/30 border border-white/10 px-3 py-2 hover:bg-black/50 transition-colors"
                    >
                      <X size={13} />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ) : (
              canEdit && (
                <div
                  onClick={() => coverFileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setCoverDragOver(true) }}
                  onDragLeave={() => setCoverDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setCoverDragOver(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) uploadCoverFile(file)
                  }}
                  className={`w-full aspect-video border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-3 cursor-pointer select-none ${
                    coverDragOver
                      ? 'border-gold bg-gold/5 text-gold'
                      : 'border-[var(--border)] hover:border-gold/40 hover:bg-gold/[0.02] text-[var(--fg-faint)]'
                  }`}
                >
                  <ImagePlus size={22} className="transition-colors" />
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      {uploading ? 'Uploading...' : coverDragOver ? 'Drop to upload' : 'Add a cover image'}
                    </p>
                    <p className="text-xs opacity-60 mt-0.5">
                      Click to upload, drag a file here, or paste a URL in the settings panel
                    </p>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Title */}
          <textarea
            ref={titleRef}
            value={title}
            onChange={handleTitleChange}
            disabled={!canEdit}
            placeholder="Your headline here..."
            rows={1}
            className="w-full bg-transparent border-none outline-none resize-none text-[var(--fg)] leading-tight placeholder:text-[var(--fg-faint)] disabled:opacity-60 overflow-hidden"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
              fontWeight: 700,
            }}
          />

          {/* Excerpt */}
          <textarea
            ref={excerptRef}
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            disabled={!canEdit}
            placeholder="Write a brief summary that draws readers in..."
            rows={2}
            className="w-full mt-4 bg-transparent border-none outline-none resize-none text-[var(--fg-muted)] text-lg leading-relaxed placeholder:text-[var(--fg-faint)] disabled:opacity-60 overflow-hidden"
          />

          {/* Divider */}
          <div className="my-8 border-t border-[var(--border)]" />

          {/* PDF import */}
          <input
            ref={pdfFileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handlePdfImport}
          />
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => pdfFileRef.current?.click()}
              disabled={pdfImporting || !canEdit}
              className="inline-flex items-center gap-1.5 text-[var(--fg-muted)] text-xs px-3 py-1.5 border border-[var(--border)] hover:border-gold hover:text-gold transition-colors disabled:opacity-50"
            >
              <FileUp size={13} />
              {pdfImporting ? 'Importing…' : 'Import PDF'}
            </button>
            {pdfError && <span className="text-red-500 text-xs">{pdfError}</span>}
          </div>

          {/* Content editor */}
          <TiptapEditor
            ref={editorRef}
            content={content}
            onChange={handleContentChange}
            editable={canEdit}
          />
        </div>

        {/* Block sidebar */}
        <div className="hidden lg:flex border-l border-[var(--border)] bg-[var(--bg-subtle)] p-2">
          <BlockSidebar editorRef={editorRef} />
        </div>

        {/* Settings sidebar */}
        <div className="lg:w-72 xl:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] bg-[var(--bg)] p-5 space-y-5">

          {/* Status (editors/admins only) */}
          {!isWriter && (
            <div>
              <label className="block text-[10px] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">
                Status
              </label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full appearance-none border border-[var(--border)] px-3 py-2.5 pr-8 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PENDING_REVIEW">Pending Review</option>
                  {canPublish && <option value="PUBLISHED">Published</option>}
                  {canPublish && <option value="SCHEDULED">Scheduled</option>}
                  <option value="ARCHIVED">Archived</option>
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
              </div>
            </div>
          )}

          {/* Scheduled date picker */}
          {!isWriter && status === 'SCHEDULED' && (
            <div>
              <label className="block text-[10px] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">
                Publish At
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full border border-[var(--border)] px-3 py-2.5 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg-elevated)] cursor-pointer"
              />
              {!scheduledAt && (
                <p className="text-amber-500 text-[10px] mt-1">Pick a future date and time to schedule this article.</p>
              )}
            </div>
          )}

          {/* Writer: status badge */}
          {isWriter && (
            <div>
              <label className="block text-[10px] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">
                Status
              </label>
              <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border ${STATUS_COLOURS[currentStatus] ?? STATUS_COLOURS.DRAFT}`}>
                {STATUS_LABELS[currentStatus] ?? currentStatus}
              </span>
            </div>
          )}

          {/* Category */}
          <div>
            <label className="block text-[10px] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">
              Category
            </label>
            <div className="relative">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={!canEdit}
                className="w-full appearance-none border border-[var(--border)] px-3 py-2.5 pr-8 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg-elevated)] disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
              >
                <option value="">No category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
            </div>
          </div>

          {/* Cover image URL (fallback input) */}
          <div>
            <label className="block text-[10px] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">
              Cover image URL
            </label>
            <input
              type="url"
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="https://..."
              className="w-full border border-[var(--border)] px-3 py-2.5 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg-elevated)] placeholder:text-[var(--fg-faint)]"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[10px] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Tag size={10} />
              Tags
            </label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 text-[var(--fg-muted)] text-[10px] font-semibold px-2 py-1 bg-[var(--bg-subtle)] border border-[var(--border)]"
                  >
                    {t}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setTags(tags.filter((x) => x !== t))}
                        aria-label={`Remove ${t}`}
                        className="hover:text-gold transition-colors ml-0.5"
                      >
                        <X size={8} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {canEdit && (
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => tagInput && addTag(tagInput)}
                placeholder={tags.length < 10 ? 'Add a tag, press Enter...' : 'Max 10 tags'}
                disabled={tags.length >= 10}
                className="w-full border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-xs focus:outline-none focus:border-gold bg-[var(--bg-elevated)] placeholder:text-[var(--fg-faint)] disabled:opacity-50"
              />
            )}
            <p className="text-[var(--fg-faint)] text-[10px] mt-1.5">
              Separate with Enter or comma. Up to 10.
            </p>
          </div>

          {/* URL slug (non-writers) */}
          {!isWriter && (
            <div>
              <label className="block text-[10px] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">
                URL slug
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="url-slug"
                className="w-full border border-[var(--border)] px-3 py-2.5 text-[var(--fg)] text-xs font-mono focus:outline-none focus:border-gold bg-[var(--bg-elevated)]"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
