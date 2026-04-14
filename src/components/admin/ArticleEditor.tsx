'use client'

import React, { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Save, Send, Eye, X, Tag, ArrowLeft, Check, AlertCircle,
  ImagePlus, Loader2, ChevronDown, FileUp, Clock, Settings,
} from 'lucide-react'
import slugify from 'slugify'
import { mutate as globalMutate } from 'swr'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import { readTimeLabel, wordCountFromContent } from '@/lib/readTime'
import { DRAFTS_SWR_KEY } from '@/components/editorial/MyDrafts'

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

  // ── Field state ────────────────────────────────────────────────────────────
  const [title, setTitle]           = useState(initialData?.title ?? '')
  const [slug, setSlug]             = useState(initialData?.slug ?? '')
  const [content, setContent]       = useState(initialData?.content ?? '')
  const [excerpt, setExcerpt]       = useState(initialData?.excerpt ?? '')
  const [coverImage, setCoverImage] = useState(initialData?.coverImage ?? '')
  const [categoryId, setCategoryId] = useState(initialData?.categoryId ?? '')
  const [status, setStatus]         = useState(initialData?.status ?? 'DRAFT')
  const [scheduledAt, setScheduledAt] = useState(initialData?.scheduledAt ?? '')
  const [tags, setTags]             = useState<string[]>(initialData?.tags ?? [])
  const [tagInput, setTagInput]     = useState('')

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedVisible, setSavedVisible] = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [error, setError]           = useState('')
  const [coverError, setCoverError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pdfImporting, setPdfImporting] = useState(false)
  const [pdfError, setPdfError]     = useState('')
  const [tutorialOpen, setTutorialOpen] = useState(false)

  // ── Refs that need to be stable inside closures ────────────────────────────
  // articleIdRef holds the current article ID — set from prop on mount, then
  // updated in-place when a new article is first created via autosave.
  const articleIdRef   = useRef<string | undefined>(articleId)
  const isCreatingRef  = useRef(false)   // prevent concurrent POSTs
  const isDirtyRef     = useRef(false)   // true once user makes any change
  const autoSaveTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Keep a ref copy of every field so the autosave callback always reads the
  // latest values without depending on state (avoids stale closure issues).
  const titleRef      = useRef(title)
  const slugRef       = useRef(slug)
  const contentRef    = useRef(content)
  const excerptRef    = useRef(excerpt)
  const coverImageRef = useRef(coverImage)
  const categoryIdRef = useRef(categoryId)
  const statusRef     = useRef(status)
  const scheduledAtRef= useRef(scheduledAt)
  const tagsRef       = useRef(tags)

  useEffect(() => { titleRef.current      = title      }, [title])
  useEffect(() => { slugRef.current       = slug       }, [slug])
  useEffect(() => { contentRef.current    = content    }, [content])
  useEffect(() => { excerptRef.current    = excerpt    }, [excerpt])
  useEffect(() => { coverImageRef.current = coverImage }, [coverImage])
  useEffect(() => { categoryIdRef.current = categoryId }, [categoryId])
  useEffect(() => { statusRef.current     = status     }, [status])
  useEffect(() => { scheduledAtRef.current= scheduledAt}, [scheduledAt])
  useEffect(() => { tagsRef.current       = tags       }, [tags])

  // DOM refs
  const titleDomRef   = useRef<HTMLTextAreaElement>(null)
  const excerptDomRef = useRef<HTMLTextAreaElement>(null)
  const coverFileRef  = useRef<HTMLInputElement>(null)
  const pdfFileRef    = useRef<HTMLInputElement>(null)
  const editorRef     = useRef<TiptapEditorHandle | null>(null)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const currentStatus = initialData?.status ?? 'DRAFT'
  const canEdit = !isWriter || currentStatus === 'DRAFT' || currentStatus === 'REJECTED'

  // ── Auto-resize textareas ──────────────────────────────────────────────────
  useEffect(() => {
    const el = titleDomRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [title])

  useEffect(() => {
    const el = excerptDomRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [excerpt])

  // ── Core save function (used by autosave + manual button) ──────────────────
  const performSave = useCallback(async (overrideStatus?: string) => {
    const currentId  = articleIdRef.current
    const finalStatus = overrideStatus ?? statusRef.current

    if (finalStatus === 'SCHEDULED' && !scheduledAtRef.current) {
      setError('Please pick a future date and time to schedule this article.')
      return false
    }

    setSaveStatus('saving')
    setSavedVisible(false)

    const body = {
      title:      titleRef.current,
      slug:       slugRef.current,
      content:    contentRef.current,
      excerpt:    excerptRef.current,
      coverImage: coverImageRef.current || null,
      categoryId: categoryIdRef.current || null,
      authorId,
      status:     finalStatus,
      tags:       tagsRef.current,
      ...(finalStatus === 'SCHEDULED' && scheduledAtRef.current
        ? { scheduledAt: scheduledAtRef.current }
        : {}),
    }

    try {
      let res: Response

      if (currentId) {
        // Existing article — PATCH
        res = await fetch(`/api/articles/${currentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        // Brand-new article — guard against concurrent POSTs
        if (isCreatingRef.current) return false
        isCreatingRef.current = true
        res = await fetch('/api/articles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, status: 'DRAFT' }),
        })
        isCreatingRef.current = false
      }

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save.')
        setSaveStatus('error')
        return false
      }

      const saved = await res.json()
      setSaveStatus('saved')
      setSavedVisible(true)
      isDirtyRef.current = false

      // After first creation, store the ID and update the URL
      if (!currentId && saved.id) {
        articleIdRef.current = saved.id
        router.replace(`/editorial/articles/${saved.id}/edit`)
      }

      // Update status state if it changed (e.g. publish/unpublish)
      if (overrideStatus) setStatus(overrideStatus)

      // Tell SWR to refresh the My Drafts list
      globalMutate(DRAFTS_SWR_KEY)

      // Fade out the "Saved" indicator after 3s
      clearTimeout(savedFadeTimer.current)
      savedFadeTimer.current = setTimeout(() => setSavedVisible(false), 3000)
      clearTimeout(savedTimeoutRef.current)
      savedTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 4200)

      return true
    } catch {
      isCreatingRef.current = false
      setSaveStatus('error')
      return false
    }
  }, [authorId, router])

  // ── Debounced autosave ─────────────────────────────────────────────────────
  const scheduleAutosave = useCallback(() => {
    if (!canEdit) return
    isDirtyRef.current = true
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      void performSave()
    }, 2000)
  }, [canEdit, performSave])

  // ── Immediate save for tab-switch and page unload ──────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current && canEdit) {
        clearTimeout(autoSaveTimer.current)
        void performSave()
      }
    }
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
        // Best-effort synchronous save (no await — browser won't wait)
        void performSave()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [canEdit, performSave])

  // Cleanup timers on unmount
  useEffect(() => () => {
    clearTimeout(autoSaveTimer.current)
    clearTimeout(savedFadeTimer.current)
    clearTimeout(savedTimeoutRef.current)
  }, [])

  // ── Field change helpers ───────────────────────────────────────────────────
  const updateTitle = (val: string) => {
    setTitle(val)
    if (!articleIdRef.current) {
      setSlug(slugify(val, { lower: true, strict: true, trim: true }))
    }
    scheduleAutosave()
  }

  const handleContentChange = useCallback((c: string) => {
    setContent(c)
    scheduleAutosave()
  }, [scheduleAutosave])

  // ── Manual save / publish buttons ─────────────────────────────────────────
  const handleSave = async (overrideStatus?: string) => {
    if (overrideStatus && overrideStatus !== 'DRAFT' && !titleRef.current.trim()) {
      setError('A title is required before publishing or submitting.')
      return
    }
    clearTimeout(autoSaveTimer.current)
    setError('')
    await performSave(overrideStatus)

    if (!articleIdRef.current) return
    // If article already existed, refresh after publish/status change
    if (overrideStatus && articleId) {
      router.refresh()
    }
  }

  // ── Back navigation ────────────────────────────────────────────────────────
  const handleBack = async () => {
    if (isDirtyRef.current && canEdit) {
      clearTimeout(autoSaveTimer.current)
      await performSave()
    }
    router.push(returnUrl ?? '/editorial')
  }

  // ── Tag helpers ────────────────────────────────────────────────────────────
  const addTag = (raw: string) => {
    const name = raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    if (name && !tags.includes(name) && tags.length < 10) {
      const next = [...tags, name]
      setTags(next)
      tagsRef.current = next
    }
    setTagInput('')
    scheduleAutosave()
  }

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      const next = tags.slice(0, -1)
      setTags(next)
      tagsRef.current = next
      scheduleAutosave()
    }
  }

  // ── Cover image upload ─────────────────────────────────────────────────────
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
        coverImageRef.current = data.url
        scheduleAutosave()
      } else {
        setCoverError(data.error ?? 'Upload failed.')
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

  // ── PDF import ─────────────────────────────────────────────────────────────
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

  // ── Metadata panel (shared between right panel + mobile drawer) ────────────
  const renderMetadataFields = () => (
    <div className="space-y-0">

      {/* Read time + word count */}
      <div className="flex items-center gap-2 pb-3 mb-1 border-b border-[#e8e8e8]">
        <Clock size={11} className="text-[#aaa] shrink-0" />
        <span className="text-[12px] text-[#aaa] uppercase tracking-wider font-medium">
          {content.length > 2 ? readTimeLabel(content) : '— min read'}
        </span>
        {content.length > 2 && (
          <>
            <span className="text-[#ddd]">·</span>
            <span className="text-[12px] text-[#aaa] uppercase tracking-wider font-medium">
              {wordCountFromContent(content).toLocaleString()} words
            </span>
          </>
        )}
      </div>

      {/* Status */}
      {!isWriter ? (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[#999] mb-1 mt-3">Status</label>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); statusRef.current = e.target.value; scheduleAutosave() }}
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
            onChange={(e) => { setScheduledAt(e.target.value); scheduledAtRef.current = e.target.value; scheduleAutosave() }}
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
            onChange={(e) => { setCategoryId(e.target.value); categoryIdRef.current = e.target.value; scheduleAutosave() }}
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
        <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
        <input
          type="url"
          value={coverImage}
          onChange={(e) => { setCoverImage(e.target.value); coverImageRef.current = e.target.value; scheduleAutosave() }}
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
              className="w-full object-contain rounded border border-[#e0e0e0] bg-[#f5f5f5]"
              style={{ maxHeight: 80 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => { setCoverImage(''); coverImageRef.current = ''; scheduleAutosave() }}
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
              <span key={t} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-[#f1f3f4] rounded text-[#555]">
                {t}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => { const next = tags.filter((x) => x !== t); setTags(next); tagsRef.current = next; scheduleAutosave() }}
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
            onChange={(e) => { setSlug(e.target.value); slugRef.current = e.target.value; scheduleAutosave() }}
            placeholder="url-slug"
            className="w-full h-8 text-[11px] font-mono border border-[#d0d0d0] rounded px-2 bg-white focus:outline-none focus:border-[#1a2744]"
          />
        </div>
      )}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full">

      {/* FIXED: Top chrome (48px) */}
      <div className="fixed top-0 left-[220px] right-0 z-50 h-12 bg-white border-b border-[#e0e0e0] flex items-center px-3 gap-2">
        <button
          onClick={handleBack}
          className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#555] transition-colors shrink-0"
          aria-label="Back to articles"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Inline title */}
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

        {/* Autosave status indicator */}
        <div className="shrink-0 flex items-center gap-1 min-w-[70px] justify-end">
          {saveStatus === 'saving' && (
            <>
              <Loader2 size={11} className="animate-spin text-[#aaa]" />
              <span className="text-[11px] text-[#aaa] hidden sm:inline">Saving…</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <span
              className="flex items-center gap-1 text-[11px] text-[#aaa] transition-opacity duration-1000"
              style={{ opacity: savedVisible ? 1 : 0 }}
            >
              <Check size={11} className="text-emerald-500" />
              <span className="hidden sm:inline">Saved</span>
            </span>
          )}
          {saveStatus === 'error' && (
            <>
              <AlertCircle size={11} className="text-red-400" />
              <span className="text-[11px] text-red-400 hidden sm:inline">Save failed</span>
            </>
          )}
        </div>

        {/* View live */}
        {articleIdRef.current && status === 'PUBLISHED' && (
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

        {/* Tutorial button */}
        <button
          onClick={() => setTutorialOpen(true)}
          aria-label="Open editor tutorial"
          className="shrink-0 w-7 h-7 rounded-full border border-[#d0d0d0] bg-transparent flex items-center justify-center text-[13px] font-medium text-[#555] hover:bg-[#f1f3f4] transition-colors dark:border-[#444] dark:text-[#aaa] dark:hover:bg-[#2a2a2a]"
        >
          ?
        </button>

        {/* Save draft button */}
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

      {/* Content (below both fixed bars = 88px) */}
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

          {/* Document card */}
          <div
            className="flex-none w-full max-w-[816px] bg-white"
            style={{
              boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
              minHeight: 'calc(100vh - 120px)',
            }}
          >
            {/* Cover image block — full bleed above padded content */}
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
                    className="w-full h-full object-contain"
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
                        onClick={() => { setCoverImage(''); coverImageRef.current = ''; scheduleAutosave() }}
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

              {/* Headline */}
              <textarea
                ref={titleDomRef}
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
                ref={excerptDomRef}
                value={excerpt}
                onChange={(e) => { setExcerpt(e.target.value); excerptRef.current = e.target.value; scheduleAutosave() }}
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

              {/* Body editor */}
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

          {/* Right metadata panel (hidden below 1100px) */}
          <div className="hidden min-[1100px]:block flex-none w-[220px] sticky top-24">
            <div className="bg-white border border-[#e0e0e0] rounded-lg p-4 overflow-hidden">
              {renderMetadataFields()}
            </div>
          </div>

        </div>
      </div>

      {/* Mobile settings drawer */}
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

      {/* Tutorial modal */}
      {tutorialOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[70] bg-black/40"
            onClick={() => setTutorialOpen(false)}
          />
          {/* Modal */}
          <div
            className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl flex flex-col"
              style={{ maxWidth: 680, maxHeight: '80vh', borderRadius: 16 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e8e8] dark:border-[#333] shrink-0">
                <h2
                  className="text-[15px] font-semibold text-[#1a1a1a] dark:text-[#e8e8e8]"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  How to use the article editor
                </h2>
                <button
                  onClick={() => setTutorialOpen(false)}
                  aria-label="Close tutorial"
                  className="w-7 h-7 flex items-center justify-center rounded text-[#999] dark:text-[#666] hover:bg-[#f1f3f4] dark:hover:bg-[#2a2a2a] hover:text-[#333] dark:hover:text-[#ccc] transition-colors text-[18px] leading-none"
                >
                  ×
                </button>
              </div>

              {/* Modal body — scrollable */}
              <div className="overflow-y-auto px-6 py-5 space-y-0 text-[14px] leading-[1.7] text-[#333] dark:text-[#ccc]">

                {/* Getting started */}
                <TutorialSection title="Getting started">
                  <p>Your article auto-saves as you type — you will see &ldquo;Saving&rdquo; then &ldquo;Saved&rdquo; in the top bar. Click &ldquo;Save draft&rdquo; to save manually at any time.</p>
                </TutorialSection>

                {/* Formatting */}
                <TutorialSection title="Formatting buttons">
                  <ul className="space-y-1 mt-1">
                    <TutorialItem label="B">Bold</TutorialItem>
                    <TutorialItem label="I">Italic</TutorialItem>
                    <TutorialItem label="U">Underline</TutorialItem>
                    <TutorialItem label="S">Strikethrough</TutorialItem>
                    <TutorialItem label="T (colour)">Text colour: select text, pick from grid</TutorialItem>
                    <TutorialItem label="Highlight">Background colour behind selected text</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Structure */}
                <TutorialSection title="Structure buttons">
                  <ul className="space-y-1 mt-1">
                    <TutorialItem label="Normal text / H2 / H3 / H4">Section headings. H2 is a main section, H3 a sub-section.</TutorialItem>
                    <TutorialItem label="Bullet list">Press Tab to indent a level deeper</TutorialItem>
                    <TutorialItem label="Numbered list" />
                    <TutorialItem label="Blockquote">Pull quote with gold left border</TutorialItem>
                    <TutorialItem label="Code block">Monospaced formatting</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Insert */}
                <TutorialSection title="Insert buttons">
                  <ul className="space-y-1 mt-1">
                    <TutorialItem label="Link">Highlight text first, then click to add URL</TutorialItem>
                    <TutorialItem label="Image">Inserts image at cursor position</TutorialItem>
                    <TutorialItem label="Table">Hover grid to choose size, click to insert</TutorialItem>
                    <TutorialItem label="Horizontal rule">Dividing line across the page</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Alignment */}
                <TutorialSection title="Alignment">
                  <p>Left, centre, and right alignment for the paragraph.</p>
                </TutorialSection>

                {/* Right panel */}
                <TutorialSection title="Right panel">
                  <ul className="space-y-1 mt-1">
                    <TutorialItem label="Status">Draft while writing. Publish when ready (editors/admins) or Submit for review (writers).</TutorialItem>
                    <TutorialItem label="Category">Assign to News, Opinion, Analysis etc.</TutorialItem>
                    <TutorialItem label="Cover image">Paste URL or upload file</TutorialItem>
                    <TutorialItem label="Tags">Up to 10 tags, press Enter or comma after each</TutorialItem>
                    <TutorialItem label="URL slug">Auto-generated from headline, editable</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Dark mode */}
                <TutorialSection title="Dark mode">
                  <p>Click the moon icon to switch to dark mode. Preference is saved automatically.</p>
                </TutorialSection>

                {/* Word count */}
                <TutorialSection title="Word count" last>
                  <p>Updates live as you type, shown in the right panel.</p>
                </TutorialSection>

              </div>
            </div>
          </div>
        </>
      )}

    </div>
  )
}

// ── Tutorial modal sub-components ─────────────────────────────────────────────

function TutorialSection({
  title,
  children,
  last,
}: {
  title: string
  children?: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={`py-4 ${last ? '' : 'border-b border-[#ebebeb] dark:border-[#2e2e2e]'}`}>
      <p
        className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#999] dark:text-[#666] mb-2"
      >
        {title}
      </p>
      {children}
    </div>
  )
}

function TutorialItem({
  label,
  children,
}: {
  label: string
  children?: React.ReactNode
}) {
  return (
    <li className="flex gap-2">
      <span className="shrink-0 inline-block font-medium text-[#555] dark:text-[#aaa] min-w-[120px]">
        {label}
      </span>
      {children && (
        <span className="text-[#555] dark:text-[#999]">{children}</span>
      )}
    </li>
  )
}
