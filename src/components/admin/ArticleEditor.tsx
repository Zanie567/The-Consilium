'use client'

import React, { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Save, Send, Eye, X, Tag, ArrowLeft, Check, AlertCircle,
  ImagePlus, Loader2, ChevronDown, FileUp, Clock, Settings,
} from 'lucide-react'
import slugify from 'slugify'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import { readTimeLabel } from '@/lib/readTime'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[400px]" /> }
) as React.ForwardRefExoticComponent<
  {
    content?: string
    onChange: (content: string) => void
    editable?: boolean
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
    toolbarFixed?: boolean
    contentOnly?: boolean
  } &
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
    scheduledAt?: string | null
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
  const [scheduledAt, setScheduledAt] = useState(initialData?.scheduledAt ?? '')
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [isDirty, setIsDirty] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [coverError, setCoverError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // Shared title updater — used by both top chrome input and document textarea
  const updateTitle = (val: string) => {
    setTitle(val)
    setIsDirty(true)
    if (!articleId) {
      setSlug(slugify(val, { lower: true, strict: true, trim: true }))
    }
  }

  const handleContentChange = useCallback((c: string) => {
    setContent(c)
    setIsDirty(true)
  }, [])

  const handleBack = async () => {
    if (isDirty && articleId && title.trim()) {
      setSaveStatus('saving')
      try {
        await fetch(`/api/articles/${articleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody()),
        })
        setIsDirty(false)
      } catch {
        // proceed even if save fails
      }
    }
    router.push(returnUrl ?? '/editorial')
  }

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

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

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
        setIsDirty(false)
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
      setIsDirty(false)
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

  // ── Metadata panel (rendered in right panel + mobile drawer) ──────────────
  const renderMetadataFields = () => (
    <div className="space-y-0">

      {/* Read time */}
      <div className="flex items-center gap-1.5 pb-3 mb-1 border-b border-[#e8e8e8]">
        <Clock size={11} className="text-[#aaa] shrink-0" />
        <span className="text-[12px] text-[#aaa] uppercase tracking-wider font-medium">
          {content.length > 2 ? readTimeLabel(content) : '— min read'}
        </span>
      </div>

      {/* Status */}
      {!isWriter ? (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3">Status</label>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full h-8 text-[12px] border border-[#d0d0d0] rounded px-2 pr-6 bg-white focus:outline-none focus:border-[#1a2744] appearance-none cursor-pointer"
            >
              <option value="DRAFT">Draft</option>
              <option value="PENDING_REVIEW">Pending Review</option>
              {canPublish && <option value="PUBLISHED">Published</option>}
              {canPublish && <option value="SCHEDULED">Scheduled</option>}
              <option value="ARCHIVED">Archived</option>
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#aaa] pointer-events-none" />
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3">Status</label>
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-1 border rounded ${STATUS_COLOURS[currentStatus] ?? STATUS_COLOURS.DRAFT}`}>
            {STATUS_LABELS[currentStatus] ?? currentStatus}
          </span>
        </div>
      )}

      {/* Scheduled date */}
      {!isWriter && status === 'SCHEDULED' && (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3">Publish At</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full h-8 text-[12px] border border-[#d0d0d0] rounded px-2 bg-white focus:outline-none focus:border-[#1a2744] cursor-pointer"
          />
          {!scheduledAt && (
            <p className="text-amber-500 text-[10px] mt-1">Pick a future date and time.</p>
          )}
        </div>
      )}

      {/* Category */}
      <div>
        <label className="block text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3">Category</label>
        <div className="relative">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={!canEdit}
            className="w-full h-8 text-[12px] border border-[#d0d0d0] rounded px-2 pr-6 bg-white focus:outline-none focus:border-[#1a2744] appearance-none cursor-pointer disabled:opacity-60"
          >
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#aaa] pointer-events-none" />
        </div>
      </div>

      {/* Cover image */}
      <div>
        <label className="block text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3">Cover Image</label>
        <input
          ref={coverFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverUpload}
        />
        <input
          type="url"
          value={coverImage}
          onChange={(e) => setCoverImage(e.target.value)}
          placeholder="https://..."
          className="w-full h-8 text-[12px] border border-[#d0d0d0] rounded px-2 bg-white focus:outline-none focus:border-[#1a2744] placeholder:text-[#ccc]"
        />
        {uploading && <p className="text-[10px] text-[#999] mt-1">Uploading…</p>}
        {coverError && <p className="text-[10px] text-red-500 mt-1">{coverError}</p>}
        {coverImage && (
          <div className="mt-2 relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImage}
              alt="Cover preview"
              className="w-full object-cover rounded border border-[#e0e0e0]"
              style={{ height: 60 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => setCoverImage('')}
                className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                aria-label="Remove cover image"
              >
                <X size={10} />
              </button>
            )}
          </div>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => coverFileRef.current?.click()}
            disabled={uploading}
            className="mt-2 w-full h-7 text-[11px] border border-dashed border-[#d0d0d0] rounded text-[#aaa] hover:border-[#999] hover:text-[#666] transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <ImagePlus size={11} />
            {uploading ? 'Uploading…' : 'Upload file'}
          </button>
        )}
      </div>

      {/* Tags */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3 flex items-center gap-1">
          <Tag size={9} />
          Tags
        </label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5 mt-1">
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-[#f1f3f4] rounded text-[#555]"
              >
                {t}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    aria-label={`Remove ${t}`}
                    className="hover:text-red-500 transition-colors ml-0.5"
                  >
                    <X size={7} />
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
            className="w-full h-8 text-[12px] border border-[#d0d0d0] rounded px-2 bg-white focus:outline-none focus:border-[#1a2744] placeholder:text-[#ccc] disabled:opacity-50"
          />
        )}
        <p className="text-[10px] text-[#ccc] mt-1">Separate with Enter or comma. Up to 10.</p>
      </div>

      {/* URL slug */}
      {!isWriter && (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3">URL Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="url-slug"
            className="w-full h-8 text-[11px] font-mono border border-[#d0d0d0] rounded px-2 bg-white focus:outline-none focus:border-[#1a2744]"
          />
        </div>
      )}
    </div>
  )

  return (
    <div className="min-h-full">

      {/* ── FIXED: Top chrome (48px) ───────────────────────────────────────── */}
      <div className="fixed top-0 left-[220px] right-0 z-50 h-12 bg-white border-b border-[#e0e0e0] flex items-center px-3 gap-2">
        <button
          onClick={handleBack}
          className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#555] transition-colors shrink-0"
          aria-label="Back to articles"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Inline title input */}
        <input
          type="text"
          value={title}
          onChange={(e) => updateTitle(e.target.value)}
          disabled={!canEdit}
          placeholder="Untitled document"
          className="flex-1 min-w-0 text-[15px] bg-transparent border-none outline-none placeholder:text-[#bbb] disabled:opacity-60 text-[#1a1a1a]"
        />

        {/* Status pill */}
        <span className={`hidden sm:inline-flex shrink-0 items-center text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${STATUS_COLOURS[status] ?? STATUS_COLOURS.DRAFT}`}>
          {STATUS_LABELS[status] ?? status}
        </span>

        {/* Save indicator */}
        <div className="shrink-0 flex items-center gap-1 text-xs min-w-[60px] justify-end">
          {saveStatus === 'saving' && (
            <>
              <Loader2 size={11} className="animate-spin text-[#999]" />
              <span className="text-[#999] hidden sm:inline text-[11px]">Saving</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check size={11} className="text-emerald-500" />
              <span className="text-emerald-500 hidden sm:inline text-[11px]">Saved</span>
            </>
          )}
          {saveStatus === 'error' && (
            <>
              <AlertCircle size={11} className="text-red-500" />
              <span className="text-red-500 hidden sm:inline text-[11px]">Error</span>
            </>
          )}
        </div>

        {/* View live */}
        {articleId && status === 'PUBLISHED' && (
          <a
            href={`/articles/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex shrink-0 items-center gap-1 text-[#555] text-[12px] px-2.5 h-8 rounded border border-[#d0d0d0] hover:border-[#1a2744] hover:text-[#1a2744] transition-colors"
          >
            <Eye size={12} />
            View live
          </a>
        )}

        {/* Save draft */}
        {canEdit && (
          <button
            onClick={() => handleSave()}
            disabled={saveStatus === 'saving'}
            className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[#555] text-[12px] px-3 h-8 rounded border border-[#d0d0d0] hover:border-[#1a2744] hover:text-[#1a2744] transition-colors disabled:opacity-50"
          >
            <Save size={12} />
            Save draft
          </button>
        )}

        {/* Primary CTA */}
        {canPublish && canEdit && status === 'SCHEDULED' && (
          <button
            onClick={() => handleSave('SCHEDULED')}
            disabled={saveStatus === 'saving'}
            className="shrink-0 inline-flex items-center gap-1 bg-blue-600 text-white text-[12px] font-semibold px-3 h-8 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Send size={12} />
            Schedule
          </button>
        )}
        {canPublish && canEdit && status !== 'SCHEDULED' && (
          <button
            onClick={() => handleSave(status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')}
            disabled={saveStatus === 'saving'}
            className="shrink-0 inline-flex items-center gap-1 bg-[#1a2744] text-[#c9a227] text-[12px] font-semibold px-3 h-8 rounded hover:bg-[#243460] transition-colors disabled:opacity-50"
          >
            <Send size={12} />
            {status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
          </button>
        )}
        {isWriter && (currentStatus === 'DRAFT' || currentStatus === 'REJECTED') && (
          <button
            onClick={() => handleSave('PENDING_REVIEW')}
            disabled={saveStatus === 'saving'}
            className="shrink-0 inline-flex items-center gap-1 bg-amber-600 text-white text-[12px] font-semibold px-3 h-8 rounded hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            <Send size={12} />
            Submit
          </button>
        )}

        {/* Mobile settings icon */}
        <button
          onClick={() => setSettingsOpen((o) => !o)}
          className="min-[1100px]:hidden shrink-0 p-1.5 rounded hover:bg-[#f1f3f4] text-[#555] transition-colors"
          aria-label="Document settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* TiptapEditor's fixed toolbar renders at top-12 via toolbarFixed prop */}

      {/* ── Content (below both fixed bars = 88px) ─────────────────────────── */}
      <div className="pt-[88px] min-h-screen bg-[#f0f0f0]">

        {/* Banners */}
        {(initialData?.editorNote || error || !canEdit) && (
          <div className="max-w-[1120px] mx-auto px-6 pt-5 space-y-3">
            {initialData?.editorNote && (
              <div className="bg-amber-500/8 border border-amber-500/20 px-4 py-3 rounded">
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Editor feedback</p>
                <p className="text-sm text-[#555] leading-relaxed">{initialData.editorNote}</p>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 px-4 py-3 rounded text-red-500 text-sm">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {!canEdit && (
              <div className="bg-white border border-[#e0e0e0] px-4 py-3 rounded text-[#666] text-sm">
                This article is under review and cannot be edited until an editor responds.
              </div>
            )}
          </div>
        )}

        {/* Main row: document card + right panel */}
        <div className="flex justify-center gap-6 px-6 py-8 items-start">

          {/* ── Document card ─────────────────────────────────────────────── */}
          <div
            className="flex-none w-full max-w-[816px] bg-white"
            style={{
              boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
              minHeight: 'calc(100vh - 120px)',
            }}
          >
            {/* Cover image block — full bleed above the padded content */}
            <div
              className="relative group w-full overflow-hidden bg-[#f5f5f5]"
              style={{ height: coverImage ? 240 : undefined }}
            >
              {coverImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={coverImage}
                    alt="Cover"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  {canEdit && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => coverFileRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-2 text-white text-xs font-semibold bg-black/50 border border-white/20 px-4 py-2 rounded hover:bg-black/70 transition-colors"
                      >
                        <ImagePlus size={13} />
                        {uploading ? 'Uploading…' : 'Change'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoverImage('')}
                        className="flex items-center gap-2 text-white/80 text-xs bg-black/40 border border-white/10 px-3 py-2 rounded hover:bg-black/60 transition-colors"
                      >
                        <X size={13} />
                        Remove
                      </button>
                    </div>
                  )}
                </>
              ) : (
                canEdit && (
                  <button
                    type="button"
                    onClick={() => coverFileRef.current?.click()}
                    disabled={uploading}
                    className="w-full py-4 flex items-center justify-center gap-2 text-[#ccc] text-xs hover:text-[#aaa] hover:bg-[#f0f0f0] transition-colors disabled:opacity-50"
                  >
                    <ImagePlus size={14} />
                    {uploading ? 'Uploading…' : 'Add cover image'}
                  </button>
                )
              )}
            </div>

            <div style={{ padding: '64px 128px' }}>

              {/* Headline — large, in-document */}
              <textarea
                ref={titleRef}
                value={title}
                onChange={(e) => updateTitle(e.target.value)}
                disabled={!canEdit}
                placeholder="Your headline here..."
                rows={1}
                className="w-full bg-transparent border-none outline-none resize-none leading-tight placeholder:text-[#bbb] disabled:opacity-60 overflow-hidden mb-3"
                style={{
                  color: '#1a1a1a',
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                  fontWeight: 700,
                }}
              />

              {/* Excerpt */}
              <textarea
                ref={excerptRef}
                value={excerpt}
                onChange={(e) => { setExcerpt(e.target.value); setIsDirty(true) }}
                disabled={!canEdit}
                placeholder="Write a brief summary that draws readers in..."
                rows={2}
                className="w-full bg-transparent border-none outline-none resize-none text-lg leading-relaxed placeholder:text-[#ccc] disabled:opacity-60 overflow-hidden"
                style={{ color: '#666', fontStyle: 'italic' }}
              />

              {/* Divider + PDF import */}
              <div className="mt-5 pt-4 border-t border-black/8 flex items-center gap-2">
                <input
                  ref={pdfFileRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={handlePdfImport}
                />
                <button
                  type="button"
                  onClick={() => pdfFileRef.current?.click()}
                  disabled={pdfImporting || !canEdit}
                  className="inline-flex items-center gap-1.5 text-[#888] text-xs px-3 py-1.5 border border-black/15 rounded hover:border-[#1a2744] hover:text-[#1a2744] transition-colors disabled:opacity-50"
                >
                  <FileUp size={13} />
                  {pdfImporting ? 'Importing…' : 'Import from PDF'}
                </button>
                {pdfError && <span className="text-red-500 text-xs">{pdfError}</span>}
              </div>

              {/* Body editor — toolbar is fixed by TiptapEditor, content is bare */}
              <div className="mt-6">
                <TiptapEditor
                  ref={editorRef}
                  content={content}
                  onChange={handleContentChange}
                  editable={canEdit}
                  saveStatus={saveStatus}
                  toolbarFixed
                  contentOnly
                />
              </div>
            </div>
          </div>

          {/* ── Right metadata panel (hidden below 1100px) ─────────────────── */}
          <div className="hidden min-[1100px]:block flex-none w-[220px] sticky top-24">
            <div className="bg-white border border-[#e0e0e0] rounded-lg p-4 overflow-hidden">
              {renderMetadataFields()}
            </div>
          </div>

        </div>
      </div>

      {/* ── Mobile settings drawer ─────────────────────────────────────────── */}
      {settingsOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/20"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="fixed top-12 right-0 bottom-0 z-[61] w-72 bg-white border-l border-[#e0e0e0] overflow-y-auto p-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-[#333]">Document settings</span>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-[#999] hover:text-[#333] transition-colors p-1 rounded hover:bg-[#f1f3f4]"
                aria-label="Close settings"
              >
                <X size={16} />
              </button>
            </div>
            {renderMetadataFields()}
          </div>
        </>
      )}

    </div>
  )
}
