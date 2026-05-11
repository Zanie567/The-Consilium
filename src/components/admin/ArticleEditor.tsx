'use client'

import React, { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Save, Send, Eye, X, Tag, ArrowLeft, Check, AlertCircle,
  ImagePlus, Loader2, ChevronDown, Clock, Settings,
  Bold, Italic, Underline, Strikethrough, Type, Highlighter,
  List, ListOrdered, Quote, Code2, Link2, Upload,
  Table, Minus, AlignLeft, AlignCenter, AlignRight,
  Moon, Sun, Heading2,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import slugify from 'slugify'
import { mutate as globalMutate } from 'swr'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import {
  EDITORIAL_TIME_ZONE_LABEL,
  getEditorialScheduleMinInput,
} from '@/lib/editorialSchedule'
import { readTimeLabel, wordCountFromContent } from '@/lib/readTime'
import { DRAFTS_SWR_KEY } from '@/components/editorial/DraftsSection'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[400px]" /> }
) as React.ForwardRefExoticComponent<
  {
    content?: string
    onChange: (content: string) => void
    editable?: boolean
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
    toolbarPortalRef?: React.RefObject<HTMLDivElement | null>
    noWrapper?: boolean
    darkMode?: boolean
  } &
  React.RefAttributes<TiptapEditorHandle>
>

interface Category {
  id: string
  name: string
  slug: string
}

interface UserOption {
  id: string
  name: string | null
  role: string
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
    authorId?: string
  }
  categories: Category[]
  /** The ID of the currently logged-in user - used as fallback when creating a new article */
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
  const { theme, setTheme } = useTheme()
  const [themeMounted, setThemeMounted] = useState(false)
  useEffect(() => setThemeMounted(true), [])

  // Fetch the list of all editorial users so admins/editors can override the author
  useEffect(() => {
    if (isWriter) return // writers cannot change authorship
    fetch('/api/editorial/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: UserOption[]) => { if (Array.isArray(data)) setUsers(data) })
      .catch(() => {})
  }, [isWriter])
  const isDark = theme === 'dark'

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
  // Author override: default to the article's existing author, or the session user for new articles
  const [selectedAuthorId, setSelectedAuthorId] = useState(initialData?.authorId ?? authorId)
  const [users, setUsers]           = useState<UserOption[]>([])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedVisible, setSavedVisible] = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [error, setError]           = useState('')
  const [coverError, setCoverError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [toolbarHeight, setToolbarHeight] = useState(44)

  // ── Refs that need to be stable inside closures ────────────────────────────
  // articleIdRef holds the current article ID - set from prop on mount, then
  // updated in-place when a new article is first created via autosave.
  const articleIdRef   = useRef<string | undefined>(articleId)
  const isCreatingRef  = useRef(false)   // prevent concurrent POSTs
  const isDirtyRef     = useRef(false)   // true once user makes any change
  const autoSaveTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Keep a ref copy of every field so the autosave callback always reads the
  // latest values without depending on state (avoids stale closure issues).
  const titleRef           = useRef(title)
  const slugRef            = useRef(slug)
  const contentRef         = useRef(content)
  const excerptRef         = useRef(excerpt)
  const coverImageRef      = useRef(coverImage)
  const categoryIdRef      = useRef(categoryId)
  const statusRef          = useRef(status)
  const scheduledAtRef     = useRef(scheduledAt)
  const tagsRef            = useRef(tags)
  const selectedAuthorIdRef= useRef(selectedAuthorId)

  useEffect(() => { titleRef.current           = title           }, [title])
  useEffect(() => { slugRef.current            = slug            }, [slug])
  useEffect(() => { contentRef.current         = content         }, [content])
  useEffect(() => { excerptRef.current         = excerpt         }, [excerpt])
  useEffect(() => { coverImageRef.current      = coverImage      }, [coverImage])
  useEffect(() => { categoryIdRef.current      = categoryId      }, [categoryId])
  useEffect(() => { statusRef.current          = status          }, [status])
  useEffect(() => { scheduledAtRef.current     = scheduledAt     }, [scheduledAt])
  useEffect(() => { tagsRef.current            = tags            }, [tags])
  useEffect(() => { selectedAuthorIdRef.current= selectedAuthorId}, [selectedAuthorId])

  // DOM refs
  const titleDomRef   = useRef<HTMLTextAreaElement>(null)
  const excerptDomRef = useRef<HTMLTextAreaElement>(null)
  const coverFileRef  = useRef<HTMLInputElement>(null)
  const editorRef     = useRef<TiptapEditorHandle | null>(null)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Portal target for the Tiptap formatting toolbar (rendered fixed below the top chrome)
  const toolbarPortalRef = useRef<HTMLDivElement>(null)

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
      // Send the selected author - admins/editors can override; writers always
      // use their own session ID (selectedAuthorIdRef defaults to authorId prop).
      authorId:   selectedAuthorIdRef.current,
      status:     finalStatus,
      tags:       tagsRef.current,
      ...(finalStatus === 'SCHEDULED' && scheduledAtRef.current
        ? { scheduledAt: scheduledAtRef.current }
        : {}),
    }

    try {
      let res: Response

      if (currentId) {
        // Existing article - PATCH
        res = await fetch(`/api/articles/${currentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        // Brand-new article - guard against concurrent POSTs
        if (isCreatingRef.current) return false
        isCreatingRef.current = true
        res = await fetch('/api/articles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, status: 'DRAFT' }),
        })
        // BUG-12: Do NOT release the lock here. If the response is not ok we
        // keep isCreatingRef.current = true so autosave cannot fire a second
        // POST and create a duplicate. The lock is released only on success
        // below, or when the user clicks Save manually (handleSave resets it).
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to save.')
        setSaveStatus('error')
        return false
      }

      const saved = await res.json()
      setSaveStatus('saved')
      setSavedVisible(true)
      isDirtyRef.current = false

      // After first creation, store the ID, update the URL, and release the lock
      if (!currentId && saved.id) {
        articleIdRef.current = saved.id
        isCreatingRef.current = false // BUG-12: release lock only after confirmed success
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
        // Best-effort synchronous save (no await - browser won't wait)
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

  // Measure toolbar height so content offset stays correct when toolbar wraps on mobile
  useEffect(() => {
    const el = toolbarPortalRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setToolbarHeight(el.offsetHeight || 44)
    })
    observer.observe(el)
    return () => observer.disconnect()
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
    // BUG-12: Reset the creation lock so the user can always retry manually
    // after a failed initial POST, even though autosave stays blocked.
    isCreatingRef.current = false
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



  // ── Metadata panel (shared between right panel + mobile drawer) ────────────
  const renderMetadataFields = () => (
    <div className="space-y-0">

      {/* Read time + word count */}
      <div className="flex items-center gap-2 pb-3 mb-1 border-b border-[var(--border)]">
        <Clock size={11} className="text-[var(--fg-faint)] shrink-0" />
        <span className="text-[12px] text-[var(--fg-faint)] uppercase tracking-wider font-medium">
          {content.length > 2 ? readTimeLabel(content) : '- min read'}
        </span>
        {content.length > 2 && (
          <>
            <span className="text-[var(--fg-faint)]">·</span>
            <span className="text-[12px] text-[var(--fg-faint)] uppercase tracking-wider font-medium">
              {wordCountFromContent(content).toLocaleString()} words
            </span>
          </>
        )}
      </div>

      {/* Status */}
      {!isWriter ? (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3">Status</label>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); statusRef.current = e.target.value; scheduleAutosave() }}
              className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 pr-6 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold appearance-none cursor-pointer"
            >
              <option value="DRAFT">Draft</option>
              <option value="PENDING_REVIEW">Pending Review</option>
              {canPublish && <option value="PUBLISHED">Published</option>}
              {canPublish && <option value="SCHEDULED">Scheduled</option>}
              <option value="ARCHIVED">Archived</option>
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3">Status</label>
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-1 border rounded ${STATUS_COLOURS[currentStatus] ?? STATUS_COLOURS.DRAFT}`}>
            {STATUS_LABELS[currentStatus] ?? currentStatus}
          </span>
        </div>
      )}

      {/* Author override - only visible to editors/admins */}
      {!isWriter && users.length > 0 && (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3">Author</label>
          <div className="relative">
            <select
              value={selectedAuthorId}
              onChange={(e) => {
                setSelectedAuthorId(e.target.value)
                selectedAuthorIdRef.current = e.target.value
                scheduleAutosave()
              }}
              disabled={!canEdit}
              className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 pr-6 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold appearance-none cursor-pointer disabled:opacity-60"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.id}
                  {u.role !== 'WRITER' ? ` (${u.role.charAt(0) + u.role.slice(1).toLowerCase()})` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
          </div>
        </div>
      )}

      {/* Scheduled date */}
      {!isWriter && status === 'SCHEDULED' && (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3">
            Publish At ({EDITORIAL_TIME_ZONE_LABEL})
          </label>
          <input
            type="datetime-local"
            value={scheduledAt}
            min={getEditorialScheduleMinInput()}
            onChange={(e) => { setScheduledAt(e.target.value); scheduledAtRef.current = e.target.value; scheduleAutosave() }}
            className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold cursor-pointer"
          />
          <p className="text-[10px] text-[var(--fg-faint)] mt-1">
            Stored and displayed as UK editorial time.
          </p>
          {!scheduledAt && (
            <p className="text-amber-500 text-[10px] mt-1">Pick a future date and time.</p>
          )}
        </div>
      )}

      {/* Category */}
      <div>
        <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3">Category</label>
        <div className="relative">
          <select
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); categoryIdRef.current = e.target.value; scheduleAutosave() }}
            disabled={!canEdit}
            className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 pr-6 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold appearance-none cursor-pointer disabled:opacity-60"
          >
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
        </div>
      </div>

      {/* Cover image */}
      <div>
        <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3">Cover Image</label>
        <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
        <input
          type="url"
          value={coverImage}
          onChange={(e) => { setCoverImage(e.target.value); coverImageRef.current = e.target.value; scheduleAutosave() }}
          placeholder="https://..."
          className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold placeholder:text-[var(--fg-faint)]"
        />
        {uploading && <p className="text-[10px] text-[var(--fg-faint)] mt-1">Uploading…</p>}
        {coverError && <p className="text-[10px] text-red-500 mt-1">{coverError}</p>}
        {coverImage && (
          <div className="mt-2 relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImage}
              alt="Cover preview"
              className="w-full object-contain rounded border border-[var(--border)] bg-[var(--bg-subtle)]"
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
            className="mt-2 w-full h-7 text-[11px] border border-dashed border-[var(--border)] rounded text-[var(--fg-faint)] hover:border-gold hover:text-[var(--fg-muted)] transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <ImagePlus size={11} />
            {uploading ? 'Uploading…' : 'Upload file'}
          </button>
        )}
        <p className="text-xs text-gray-400 mt-1.5 leading-snug">
          For best results: landscape orientation, minimum 1200&nbsp;px wide, subject centred in frame.
        </p>
      </div>

      {/* Tags */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3 flex items-center gap-1">
          <Tag size={9} />
          Tags
        </label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5 mt-1">
            {tags.map((t) => (
              <span key={t} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-[var(--bg-subtle)] rounded text-[var(--fg-muted)]">
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
            className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold placeholder:text-[var(--fg-faint)] disabled:opacity-50"
          />
        )}
        <p className="text-[10px] text-[var(--fg-faint)] mt-1">Separate with Enter or comma. Up to 10.</p>
      </div>

      {/* URL slug */}
      {!isWriter && (
        <div>
          <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3">URL Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); slugRef.current = e.target.value; scheduleAutosave() }}
            placeholder="url-slug"
            className="w-full h-8 text-[16px] sm:text-[11px] font-mono border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold"
          />
        </div>
      )}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full">

      {/* FIXED: Top chrome (48px) - full-width on mobile, offset by sidebar on md+ */}
      <div className="fixed top-0 left-0 md:left-12 lg:left-[220px] right-0 z-50 h-12 bg-[var(--bg-elevated)] border-b border-[var(--border)] flex items-center pl-[52px] md:pl-3 pr-3 gap-2">
        <button
          onClick={handleBack}
          className="p-1.5 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors shrink-0"
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
          className="flex-1 min-w-0 bg-transparent border-none outline-none placeholder:text-[var(--fg-faint)] disabled:opacity-60 text-[var(--fg)]"
          style={{ fontSize: 16 }}
        />

        {/* Status pill */}
        <span className={`hidden sm:inline-flex shrink-0 items-center text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${STATUS_COLOURS[status] ?? STATUS_COLOURS.DRAFT}`}>
          {STATUS_LABELS[status] ?? status}
        </span>

        {/* Autosave status indicator */}
        <div className="shrink-0 flex items-center gap-1 min-w-[70px] justify-end">
          {saveStatus === 'saving' && (
            <>
              <Loader2 size={11} className="animate-spin text-[var(--fg-faint)]" />
              <span className="text-[11px] text-[var(--fg-faint)] hidden sm:inline">Saving…</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <span
              className="flex items-center gap-1 text-[11px] text-[var(--fg-faint)] transition-opacity duration-1000"
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
            className="hidden md:inline-flex shrink-0 items-center gap-1 text-[var(--fg-muted)] text-[12px] px-2.5 h-8 rounded border border-[var(--border)] hover:border-gold hover:text-gold transition-colors"
          >
            <Eye size={12} />
            View live
          </a>
        )}

        {/* Dark mode toggle */}
        {themeMounted && (
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="shrink-0 p-1.5 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors"
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        )}

        {/* Tutorial button */}
        <button
          onClick={() => setTutorialOpen(true)}
          aria-label="Open editor tutorial"
          className="shrink-0 w-7 h-7 rounded-full border border-[var(--border)] bg-transparent flex items-center justify-center text-[13px] font-medium text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors"
        >
          ?
        </button>

        {/* Save draft button */}
        {canEdit && (
          <button
            onClick={() => handleSave()}
            disabled={saveStatus === 'saving'}
            className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[var(--fg-muted)] text-[12px] px-3 h-8 rounded border border-[var(--border)] hover:border-gold hover:text-gold transition-colors disabled:opacity-50"
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
            className="shrink-0 inline-flex items-center gap-1 bg-navy text-gold text-[12px] font-semibold px-3 h-8 rounded hover:bg-navy-dark transition-colors disabled:opacity-50"
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
          className="min-[1100px]:hidden shrink-0 p-1.5 rounded text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-gold transition-colors"
          aria-label="Document settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Formatting toolbar - Tiptap portals its toolbar content into this fixed container */}
      <div
        ref={toolbarPortalRef}
        className="fixed top-12 left-0 md:left-12 lg:left-[220px] right-0 z-[200]"
      />

      {/* Content - offset by top chrome (48px) + measured toolbar height */}
      <div className="min-h-screen bg-[var(--bg-subtle)]" style={{ paddingTop: 48 + toolbarHeight + 4 }}>

        {/* Banners */}
        {(initialData?.editorNote || error || !canEdit) && (
          <div className="max-w-[1120px] mx-auto px-3 sm:px-6 pt-4 sm:pt-5 space-y-3">
            {initialData?.editorNote && (
              <div className="bg-amber-500/8 border border-amber-500/20 px-4 py-3 rounded">
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Editor feedback</p>
                <p className="text-sm text-[var(--fg-muted)] leading-relaxed">{initialData.editorNote}</p>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 px-4 py-3 rounded text-red-500 text-sm">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {!canEdit && (
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-3 rounded text-[var(--fg-muted)] text-sm">
                This article is under review and cannot be edited until an editor responds.
              </div>
            )}
          </div>
        )}

        {/* Main row: document card + right panel */}
        <div className="flex justify-center gap-6 px-2 sm:px-4 md:px-6 py-4 md:py-8 items-start">

          {/* Document card */}
          <div
            className="flex-none w-full max-w-[960px] bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]"
            style={{
              boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
              minHeight: 'calc(100vh - 120px)',
            }}
          >

            {/* Cover image block - full bleed above padded content */}
            <div
              className="relative group w-full overflow-hidden bg-[var(--bg-subtle)]"
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
                    className="w-full py-6 flex items-center justify-center gap-2 text-[var(--fg-faint)] text-sm font-bold hover:text-gold hover:bg-[var(--bg)] transition-colors disabled:opacity-50 tracking-wide"
                  >
                    <ImagePlus size={16} />
                    {uploading ? 'Uploading…' : 'Add cover image'}
                  </button>
                )
              )}
            </div>

            <div className="px-6 py-10 sm:px-10 sm:py-12 md:px-16 md:py-16 lg:px-20 xl:px-24">

              {/* Headline */}
              <textarea
                ref={titleDomRef}
                value={title}
                onChange={(e) => updateTitle(e.target.value)}
                disabled={!canEdit}
                placeholder="Your headline here..."
                rows={1}
                className="w-full bg-transparent border-none outline-none resize-none text-4xl sm:text-5xl font-bold leading-tight placeholder:text-[var(--fg-faint)] disabled:opacity-60 overflow-hidden mb-4 text-[var(--fg)]"
                style={{ fontFamily: 'var(--font-serif)' }}
              />

              {/* Excerpt */}
              <textarea
                ref={excerptDomRef}
                value={excerpt}
                onChange={(e) => { setExcerpt(e.target.value); excerptRef.current = e.target.value; scheduleAutosave() }}
                disabled={!canEdit}
                placeholder="Write a brief summary that draws readers in..."
                rows={2}
                className="w-full bg-transparent border-none outline-none resize-none text-xl italic leading-relaxed placeholder:text-[var(--fg-faint)] disabled:opacity-60 overflow-hidden text-[var(--fg-muted)]"
              />

              {/* Body editor */}
              <div className="mt-6">
                <TiptapEditor
                  ref={editorRef}
                  content={content}
                  onChange={handleContentChange}
                  editable={canEdit}
                  saveStatus={saveStatus}
                  toolbarPortalRef={toolbarPortalRef}
                  noWrapper
                  darkMode={isDark}
                />
              </div>
            </div>
          </div>

          {/* Right metadata panel (hidden below 1100px) */}
          <div className="hidden min-[1100px]:block flex-none w-[280px] sticky top-24">
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-5 overflow-hidden shadow-[var(--shadow-card)]">
              {renderMetadataFields()}
            </div>
          </div>

        </div>
      </div>

      {/*
       * Mobile metadata bottom sheet
       *
       * Always rendered so CSS transitions fire on open/close.
       * Slides up from translateY(100%) → translateY(0) in 300ms with
       * Material Design easing: cubic-bezier(0.4, 0, 0.2, 1).
       * Backdrop fades in simultaneously.
       */}

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40 transition-opacity duration-300"
        style={{
          opacity: settingsOpen ? 1 : 0,
          pointerEvents: settingsOpen ? 'auto' : 'none',
        }}
        onClick={() => setSettingsOpen(false)}
        aria-hidden
      />

      {/* Bottom sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-[61] bg-[var(--bg-elevated)] rounded-t-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          maxHeight: '82vh',
          transform: settingsOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}
        aria-hidden={!settingsOpen}
      >
        {/* Drag handle - decorative iOS-style pill */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-sm font-semibold text-[var(--fg)]">Document settings</span>
          <button
            onClick={() => setSettingsOpen(false)}
            className="text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors p-1.5 rounded-md hover:bg-[var(--bg-subtle)] active:scale-[0.92] transition-transform"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto p-4 flex-1">
          {renderMetadataFields()}
        </div>
      </div>

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
              className="pointer-events-auto w-full bg-[var(--bg-elevated)] dark:bg-[var(--bg-elevated)] rounded-2xl shadow-2xl flex flex-col"
              style={{ maxWidth: 680, maxHeight: '80vh', borderRadius: 16 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] dark:border-[var(--border)] shrink-0">
                <h2
                  className="text-[15px] font-semibold text-[var(--fg)] dark:text-[var(--fg)]"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  How to use the article editor
                </h2>
                <button
                  onClick={() => setTutorialOpen(false)}
                  aria-label="Close tutorial"
                  className="w-7 h-7 flex items-center justify-center rounded text-[var(--fg-faint)] dark:text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] dark:hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] dark:hover:text-[var(--fg-faint)] transition-colors text-[18px] leading-none"
                >
                  ×
                </button>
              </div>

              {/* Modal body - scrollable */}
              <div className="overflow-y-auto px-6 py-5 space-y-0 text-[14px] leading-[1.7] text-[var(--fg)] dark:text-[var(--fg-faint)]">

                {/* Getting started */}
                <TutorialSection title="Getting started">
                  <p>Your article auto-saves as you type. You will see &ldquo;Saving&rdquo; then &ldquo;Saved&rdquo; in the top bar. Click &ldquo;Save draft&rdquo; to save manually at any time.</p>
                </TutorialSection>

                {/* Formatting */}
                <TutorialSection title="Formatting buttons">
                  <ul className="space-y-2 mt-1">
                    <TutorialItem label="Bold" icon={<Bold size={13} />}>Makes selected text bold</TutorialItem>
                    <TutorialItem label="Italic" icon={<Italic size={13} />}>Makes selected text italic</TutorialItem>
                    <TutorialItem label="Underline" icon={<Underline size={13} />}>Underlines selected text</TutorialItem>
                    <TutorialItem label="Strikethrough" icon={<Strikethrough size={13} />}>Draws a line through selected text</TutorialItem>
                    <TutorialItem label="Text colour" icon={<Type size={13} />}>Select text, then pick a colour from the grid</TutorialItem>
                    <TutorialItem label="Highlight" icon={<Highlighter size={13} />}>Background colour behind selected text</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Structure */}
                <TutorialSection title="Structure buttons">
                  <ul className="space-y-2 mt-1">
                    <TutorialItem label="Headings (H2 / H3 / H4)" icon={<Heading2 size={13} />}>Section headings. H2 is a main section, H3 a sub-section.</TutorialItem>
                    <TutorialItem label="Bullet list" icon={<List size={13} />}>Press Tab to indent a level deeper</TutorialItem>
                    <TutorialItem label="Numbered list" icon={<ListOrdered size={13} />}>Ordered list with automatic numbering</TutorialItem>
                    <TutorialItem label="Blockquote" icon={<Quote size={13} />}>Pull quote with gold left border</TutorialItem>
                    <TutorialItem label="Code block" icon={<Code2 size={13} />}>Monospaced formatting for code or data</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Insert */}
                <TutorialSection title="Insert buttons">
                  <ul className="space-y-2 mt-1">
                    <TutorialItem label="Link" icon={<Link2 size={13} />}>Highlight text first, then click to add a URL</TutorialItem>
                    <TutorialItem label="Image" icon={<Upload size={13} />}>Inserts an image at the cursor position</TutorialItem>
                    <TutorialItem label="Table" icon={<Table size={13} />}>Hover the grid to choose size, click to insert</TutorialItem>
                    <TutorialItem label="Horizontal rule" icon={<Minus size={13} />}>Dividing line across the page</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Alignment */}
                <TutorialSection title="Alignment">
                  <ul className="space-y-2 mt-1">
                    <TutorialItem label="Align left" icon={<AlignLeft size={13} />}>Left-aligns the current paragraph</TutorialItem>
                    <TutorialItem label="Align centre" icon={<AlignCenter size={13} />}>Centres the current paragraph</TutorialItem>
                    <TutorialItem label="Align right" icon={<AlignRight size={13} />}>Right-aligns the current paragraph</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Right panel */}
                <TutorialSection title="Right panel">
                  <ul className="space-y-2 mt-1">
                    <TutorialItem label="Status">Draft while writing. Publish when ready (editors/admins) or Submit for review (writers).</TutorialItem>
                    <TutorialItem label="Author">Editors and admins can reassign the article to any writer or editor. Defaults to your account for new articles.</TutorialItem>
                    <TutorialItem label="Category">Assign to News, Opinion, Analysis etc.</TutorialItem>
                    <TutorialItem label="Cover image">Paste a URL or upload a file</TutorialItem>
                    <TutorialItem label="Tags">Up to 10 tags. Press Enter or comma after each.</TutorialItem>
                    <TutorialItem label="URL slug">Auto-generated from the headline, editable</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Dark mode */}
                <TutorialSection title="Dark mode">
                  <ul className="space-y-2 mt-1">
                    <TutorialItem label="Moon / Sun" icon={<Moon size={13} />}>Click to toggle dark mode. Preference is saved automatically.</TutorialItem>
                  </ul>
                </TutorialSection>

                {/* Word count */}
                <TutorialSection title="Word count" last>
                  <p>Updates live as you type, shown next to the read time in the right panel.</p>
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
    <div className={`py-4 ${last ? '' : 'border-b border-[var(--border)]'}`}>
      <p
        className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-faint)] dark:text-[var(--fg-muted)] mb-2"
      >
        {title}
      </p>
      {children}
    </div>
  )
}

function TutorialItem({
  label,
  icon,
  children,
}: {
  label: string
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-subtle)] dark:bg-[var(--bg-subtle)] text-[var(--fg-muted)] dark:text-[var(--fg-faint)]">
        {icon ?? <span className="text-[10px] font-bold leading-none">{label.slice(0, 2)}</span>}
      </span>
      <span className="flex-1 pt-[3px]">
        <span className="font-medium text-[var(--fg)]">{label}</span>
        {children && (
          <span className="text-[var(--fg-muted)]">: {children}</span>
        )}
      </span>
    </li>
  )
}
