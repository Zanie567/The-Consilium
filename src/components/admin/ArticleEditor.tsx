'use client'

import React, { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Eye, ArrowLeft, Check, AlertCircle,
  Loader2, ChevronDown, FileUp, Clock, Settings,
} from 'lucide-react'
import slugify from 'slugify'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import { readTimeLabel } from '@/lib/readTime'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="h-[640px] animate-pulse" /> }
) as React.ForwardRefExoticComponent<
  {
    content?: string
    onChange: (content: string) => void
    editable?: boolean
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
    toolbarPortalRef?: React.RefObject<HTMLDivElement | null>
    noWrapper?: boolean
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
  const [coverDragOver, setCoverDragOver] = useState(false)
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
  const toolbarContainerRef = useRef<HTMLDivElement | null>(null)
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
    // Save any unsaved changes before leaving so no work is lost
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

  // Warn before closing/navigating away in the browser if there are unsaved changes
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

  const panelLabelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#999',
    marginBottom: 4,
    marginTop: 12,
  }
  const panelInputStyle: React.CSSProperties = {
    width: '100%',
    height: 32,
    fontSize: 12,
    border: '1px solid #d0d0d0',
    borderRadius: 4,
    padding: '0 8px',
    outline: 'none',
    background: '#fff',
    color: '#333',
    boxSizing: 'border-box',
  }
  const panelSelectStyle: React.CSSProperties = {
    ...panelInputStyle,
    appearance: 'none',
    paddingRight: 24,
    cursor: 'pointer',
  }

  // Shared panel fields used in both right panel and mobile drawer
  const panelFields = (
    <>
      {/* Read time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#999', marginBottom: 12 }}>
        <Clock size={12} />
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {content.length > 2 ? readTimeLabel(content) : '1 min read'}
        </span>
      </div>

      <div style={{ height: 1, background: '#e0e0e0', marginBottom: 12 }} />

      {/* Status */}
      {!isWriter ? (
        <div style={{ marginBottom: 12 }}>
          <label style={panelLabelStyle}>Status</label>
          <div style={{ position: 'relative' }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={panelSelectStyle}>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_REVIEW">Pending Review</option>
              {canPublish && <option value="PUBLISHED">Published</option>}
              {canPublish && <option value="SCHEDULED">Scheduled</option>}
              <option value="ARCHIVED">Archived</option>
            </select>
            <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#999', pointerEvents: 'none' }} />
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <label style={panelLabelStyle}>Status</label>
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${STATUS_COLOURS[currentStatus] ?? STATUS_COLOURS.DRAFT}`}>
            {STATUS_LABELS[currentStatus] ?? currentStatus}
          </span>
        </div>
      )}

      {/* Scheduled date */}
      {!isWriter && status === 'SCHEDULED' && (
        <div style={{ marginBottom: 12 }}>
          <label style={panelLabelStyle}>Publish at</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            onChange={(e) => setScheduledAt(e.target.value)}
            style={panelInputStyle}
          />
        </div>
      )}

      {/* Category */}
      <div style={{ marginBottom: 12 }}>
        <label style={panelLabelStyle}>Category</label>
        <div style={{ position: 'relative' }}>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!canEdit} style={panelSelectStyle}>
            <option value="">No category</option>
            {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
          <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#999', pointerEvents: 'none' }} />
        </div>
      </div>

      {/* Cover image */}
      <div style={{ marginBottom: 12 }}>
        <label style={panelLabelStyle}>Cover image</label>
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
          style={panelInputStyle}
        />
        {canEdit && !coverImage && (
          <button
            type="button"
            onClick={() => coverFileRef.current?.click()}
            style={{ marginTop: 4, fontSize: 11, color: '#888', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
          >
            {uploading ? 'Uploading...' : '\u2191 Upload file'}
          </button>
        )}
        {coverImage && (
          <div style={{ marginTop: 6, position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImage}
              alt="Cover preview"
              style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, display: 'block' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            {canEdit && (
              <button type="button" onClick={() => setCoverImage('')}
                style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 3, color: '#fff', cursor: 'pointer', padding: '2px 4px', fontSize: 10 }}>
                &times;
              </button>
            )}
          </div>
        )}
        {coverError && <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{coverError}</p>}
      </div>

      {/* Tags */}
      <div style={{ marginBottom: 12 }}>
        <label style={panelLabelStyle}>Tags</label>
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {tags.map((t) => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#555', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 3, padding: '2px 6px' }}>
                {t}
                {canEdit && (
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 10, padding: 0, lineHeight: 1 }}>&times;</button>
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
            placeholder={tags.length < 10 ? 'Add tag, press Enter...' : 'Max 10 tags'}
            disabled={tags.length >= 10}
            style={panelInputStyle}
          />
        )}
      </div>

      {/* URL slug */}
      {!isWriter && (
        <div style={{ marginBottom: 12 }}>
          <label style={panelLabelStyle}>URL slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="url-slug"
            style={{ ...panelInputStyle, fontFamily: 'monospace' }}
          />
        </div>
      )}
    </>
  )

  return (
    <>
      {/* Top chrome bar (fixed) */}
      <div
        style={{
          position: 'fixed', top: 0, left: 240, right: 0, height: 48,
          background: '#fff', borderBottom: '1px solid #e0e0e0',
          zIndex: 50, display: 'flex', alignItems: 'center',
          gap: 8, padding: '0 12px',
        }}
      >
        <button
          onClick={handleBack}
          className="text-[#666] hover:text-[#1a2744] transition-colors shrink-0 p-1.5 rounded hover:bg-[#f1f3f4]"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Title input - same state as document title */}
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setIsDirty(true)
            if (!articleId) setSlug(slugify(e.target.value, { lower: true, strict: true, trim: true }))
          }}
          disabled={!canEdit}
          placeholder="Untitled document"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[#1a1a1a] disabled:opacity-60"
          style={{ fontSize: 15, fontFamily: 'var(--font-serif)' }}
        />

        {/* Status badge */}
        <span className={`shrink-0 hidden sm:inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${STATUS_COLOURS[status] ?? STATUS_COLOURS.DRAFT}`}>
          {STATUS_LABELS[status] ?? status}
        </span>

        {/* Save indicator */}
        {saveStatus === 'saving' && (
          <span className="hidden sm:flex items-center gap-1.5 text-[#999] text-xs shrink-0">
            <Loader2 size={11} className="animate-spin" /> Saving
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="hidden sm:flex items-center gap-1.5 text-emerald-500 text-xs shrink-0">
            <Check size={11} /> Saved
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="hidden sm:flex items-center gap-1.5 text-red-500 text-xs shrink-0">
            <AlertCircle size={11} /> Failed
          </span>
        )}

        {/* View live */}
        {articleId && status === 'PUBLISHED' && (
          <a href={`/articles/${slug}`} target="_blank" rel="noopener noreferrer"
            className="shrink-0 hidden md:inline-flex items-center gap-1.5 text-[#666] text-xs px-3 h-7 border border-[#d0d0d0] rounded hover:border-[#1a2744] hover:text-[#1a2744] transition-colors"
          >
            <Eye size={12} /> View live
          </a>
        )}

        {/* Save draft */}
        {canEdit && (
          <button
            onClick={() => handleSave()}
            disabled={saveStatus === 'saving'}
            className="shrink-0 text-[#444] text-xs px-3 h-7 border border-[#d0d0d0] rounded hover:border-[#1a2744] hover:text-[#1a2744] transition-colors disabled:opacity-50"
          >
            Save
          </button>
        )}

        {/* Schedule confirm */}
        {canPublish && canEdit && status === 'SCHEDULED' && (
          <button onClick={() => handleSave('SCHEDULED')} disabled={saveStatus === 'saving'}
            className="shrink-0 bg-blue-600 text-white text-xs font-semibold px-3 h-7 rounded hover:bg-blue-700 transition-colors disabled:opacity-50">
            Confirm Schedule
          </button>
        )}

        {/* Publish / Unpublish */}
        {canPublish && canEdit && status !== 'SCHEDULED' && (
          <button
            onClick={() => handleSave(status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')}
            disabled={saveStatus === 'saving'}
            className="shrink-0 text-[#c9a227] text-xs font-semibold px-3 h-7 rounded transition-colors disabled:opacity-50"
            style={{ background: '#1a2744' }}
          >
            {status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
          </button>
        )}

        {/* Writer submit */}
        {isWriter && (currentStatus === 'DRAFT' || currentStatus === 'REJECTED') && (
          <button onClick={() => handleSave('PENDING_REVIEW')} disabled={saveStatus === 'saving'}
            className="shrink-0 bg-amber-600 text-white text-xs font-semibold px-3 h-7 rounded hover:bg-amber-700 transition-colors disabled:opacity-50">
            Submit for review
          </button>
        )}

        {/* Settings toggle (visible <xl) */}
        <button
          onClick={() => setSettingsOpen((o) => !o)}
          className="shrink-0 xl:hidden p-1.5 rounded hover:bg-[#f1f3f4] text-[#666] hover:text-[#1a2744] transition-colors"
          aria-label="Article settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Toolbar bar (fixed) */}
      <div
        style={{
          position: 'fixed', top: 48, left: 240, right: 0, height: 40,
          background: '#fff', borderBottom: '1px solid #e0e0e0',
          zIndex: 49, overflow: 'hidden',
        }}
      >
        {/* TiptapEditor portals its toolbar here */}
        <div ref={toolbarContainerRef} style={{ height: '100%', display: 'flex', alignItems: 'center' }} />
      </div>

      {/* Main content area */}
      <div
        style={{
          paddingTop: 88,
          minHeight: '100vh',
          background: '#f0f0f0',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 24,
            padding: '32px 24px',
            alignItems: 'flex-start',
          }}
        >

          {/* Document card */}
          <div
            style={{
              width: '100%',
              maxWidth: 816,
              flex: 'none',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
              padding: 'clamp(32px, 5vw, 72px) clamp(24px, 8vw, 96px)',
              minHeight: 'calc(100vh - 120px)',
            }}
          >
            {/* Editor note banner */}
            {initialData?.editorNote && (
              <div className="mb-6 bg-amber-500/8 border border-amber-500/20 px-4 py-3 rounded">
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Editor feedback</p>
                <p className="text-sm text-[#555] leading-relaxed">{initialData.editorNote}</p>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="mb-6 flex items-start gap-2 bg-red-500/8 border border-red-500/20 px-4 py-3 text-red-500 text-sm rounded">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Not-editable notice */}
            {!canEdit && (
              <div className="mb-6 bg-[#f8f8f8] border border-[#e0e0e0] px-4 py-3 text-[#666] text-sm rounded">
                This article is under review and cannot be edited until an editor responds.
              </div>
            )}

            {/* Cover image thumbnail (small, only if set) */}
            {coverImage && (
              <div className="mb-5" style={{ marginLeft: 'calc(-1 * clamp(24px, 8vw, 96px))', marginRight: 'calc(-1 * clamp(24px, 8vw, 96px))' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImage}
                  alt="Cover"
                  style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </div>
            )}

            {/* Title - large headline in document */}
            <textarea
              ref={titleRef}
              value={title}
              onChange={handleTitleChange}
              disabled={!canEdit}
              placeholder="Your headline here..."
              rows={1}
              className="w-full bg-transparent border-none outline-none resize-none leading-tight placeholder:text-[#bbb] disabled:opacity-60 overflow-hidden mb-3"
              style={{
                color: '#1a1a1a',
                fontFamily: 'var(--font-serif)',
                fontSize: 32,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            />

            {/* Excerpt / summary */}
            <textarea
              ref={excerptRef}
              value={excerpt}
              onChange={(e) => { setExcerpt(e.target.value); setIsDirty(true) }}
              disabled={!canEdit}
              placeholder="Write a brief summary..."
              rows={2}
              className="w-full bg-transparent border-none outline-none resize-none leading-relaxed placeholder:text-[#ccc] disabled:opacity-60 overflow-hidden"
              style={{ color: '#666', fontSize: 16, fontStyle: 'italic' }}
            />

            {/* Divider + PDF import */}
            <div className="mt-4 mb-1 pt-4 border-t border-black/8 flex items-center gap-2">
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
                {pdfImporting ? 'Importing...' : 'Import from PDF'}
              </button>
              {pdfError && <span className="text-red-500 text-xs">{pdfError}</span>}
            </div>

            {/* Tiptap body editor (no outer wrapper - document card IS the wrapper) */}
            <TiptapEditor
              ref={editorRef}
              content={content}
              onChange={handleContentChange}
              editable={canEdit}
              saveStatus={saveStatus}
              toolbarPortalRef={toolbarContainerRef}
              noWrapper
            />
          </div>

          {/* Right metadata panel */}
          <div
            className="hidden xl:block"
            style={{
              width: 220,
              flex: 'none',
              position: 'sticky',
              top: 96,
              alignSelf: 'flex-start',
              background: '#ffffff',
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: 16,
            }}
          >
            {panelFields}
          </div>
        </div>
      </div>

      {/* Mobile settings drawer */}
      {settingsOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.3)',
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: 260, background: '#fff', padding: 20, overflowY: 'auto',
              boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>Settings</span>
              <button onClick={() => setSettingsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', fontSize: 18 }}>&times;</button>
            </div>
            {panelFields}
          </div>
        </div>
      )}
    </>
  )
}
