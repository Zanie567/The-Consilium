'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Save, Send, Eye, Upload } from 'lucide-react'
import slugify from 'slugify'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="h-96 bg-[var(--bg-subtle)] animate-pulse" /> }
)

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
  }
  categories: Category[]
  authorId: string
  canPublish: boolean
  returnUrl?: string
  isWriter?: boolean
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
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const currentStatus = initialData?.status ?? 'DRAFT'
  const canEdit = !isWriter || currentStatus === 'DRAFT' || currentStatus === 'REJECTED'

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setTitle(val)
    if (!articleId) {
      setSlug(slugify(val, { lower: true, strict: true, trim: true }))
    }
  }

  const handleContentChange = useCallback((c: string) => setContent(c), [])

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('bucket', 'article-images')
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    setUploading(false)
    if (res.ok) {
      const data = await res.json()
      setCoverImage(data.url)
    }
  }

  const handleSave = async (overrideStatus?: string) => {
    if (!title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    setError('')
    setSuccess('')

    const body = {
      title, slug, content, excerpt,
      coverImage: coverImage || null,
      categoryId: categoryId || null,
      authorId,
      status: overrideStatus ?? status,
    }

    try {
      const res = articleId
        ? await fetch(`/api/articles/${articleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/articles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save article.')
        return
      }

      const saved = await res.json()
      setSuccess(
        overrideStatus === 'PENDING_REVIEW'
          ? 'Article submitted for review.'
          : 'Article saved.'
      )
      if (!articleId) {
        router.push(returnUrl ? `${returnUrl}/${saved.id}/edit` : `/editorial/articles/${saved.id}/edit`)
      } else {
        if (overrideStatus) setStatus(overrideStatus)
        router.refresh()
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1
          className="text-xl font-bold text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {articleId ? 'Edit Article' : 'New Article'}
        </h1>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {articleId && status === 'PUBLISHED' && (
            <a
              href={`/articles/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[var(--fg-muted)] text-xs border border-[var(--border)] px-3 py-2 hover:border-gold hover:text-gold transition-colors"
            >
              <Eye size={13} />
              View Live
            </a>
          )}
          {canEdit && (
            <button
              onClick={() => handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 border border-[var(--border)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-4 py-2 hover:border-gold hover:text-gold transition-colors disabled:opacity-50"
            >
              <Save size={13} />
              Save Draft
            </button>
          )}
          {canPublish && canEdit && (
            <button
              onClick={() => handleSave(status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')}
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-navy text-gold text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-navy-dark transition-colors disabled:opacity-50"
            >
              <Send size={13} />
              {status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
            </button>
          )}
          {isWriter && (currentStatus === 'DRAFT' || currentStatus === 'REJECTED') && (
            <button
              onClick={() => handleSave('PENDING_REVIEW')}
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-amber-600 text-white text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              <Send size={13} />
              Submit for Review
            </button>
          )}
        </div>
      </div>

      {/* Editor note (returned article) */}
      {initialData?.editorNote && (
        <div className="mb-5 bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1">
            Editor Feedback
          </p>
          <p className="text-sm text-[var(--fg-muted)]">{initialData.editorNote}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-500 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-emerald-600 text-sm">
          {success}
        </div>
      )}

      {!canEdit && (
        <div className="mb-5 bg-[var(--bg-subtle)] border border-[var(--border)] px-4 py-3 text-[var(--fg-muted)] text-sm">
          This article is currently under review and cannot be edited.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main editor */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
              Title <span className="text-gold">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              disabled={!canEdit}
              placeholder="Article title"
              className="w-full border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-base font-semibold focus:outline-none focus:border-gold bg-[var(--bg-elevated)] disabled:opacity-60"
              style={{ fontFamily: 'var(--font-serif)' }}
            />
          </div>

          {!isWriter && (
            <div>
              <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
                URL Slug
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="url-slug"
                className="w-full border border-[var(--border)] px-4 py-2.5 text-[var(--fg)] text-sm font-mono focus:outline-none focus:border-gold bg-[var(--bg-elevated)]"
              />
            </div>
          )}

          <div>
            <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
              Excerpt
            </label>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              disabled={!canEdit}
              placeholder="A brief summary of the article…"
              rows={3}
              className="w-full border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg-elevated)] resize-none disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
              Content <span className="text-gold">*</span>
            </label>
            <TiptapEditor
              content={content}
              onChange={handleContentChange}
              editable={canEdit}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Status */}
          {!isWriter && (
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4">
              <h3 className="text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-3">Status</h3>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg)]"
              >
                <option value="DRAFT">Draft</option>
                <option value="PENDING_REVIEW">Pending Review</option>
                {canPublish && <option value="PUBLISHED">Published</option>}
                {canPublish && <option value="SCHEDULED">Scheduled</option>}
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
          )}

          {/* Category */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4">
            <h3 className="text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-3">Category</h3>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={!canEdit}
              className="w-full border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg)] disabled:opacity-60"
            >
              <option value="">No Category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* Cover Image */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4">
            <h3 className="text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-3">
              Cover Image
            </h3>
            <label className="flex items-center gap-2 cursor-pointer mb-3 text-xs text-[var(--fg-muted)] border border-[var(--border)] px-3 py-2 hover:border-gold hover:text-gold transition-colors">
              <Upload size={13} />
              {uploading ? 'Uploading…' : 'Upload image'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCoverUpload}
                disabled={uploading}
              />
            </label>
            <p className="text-[var(--fg-faint)] text-xs mb-2">or paste URL:</p>
            <input
              type="url"
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="https://…"
              className="w-full border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold bg-[var(--bg)]"
            />
            {coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverImage}
                alt="Cover preview"
                className="mt-3 w-full h-28 object-cover border border-[var(--border)]"
                onError={(e) => { ;(e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
          </div>

          {/* Writer status info */}
          {isWriter && (
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4">
              <h3 className="text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-2">
                Status
              </h3>
              <span className={`text-xs font-bold px-2 py-0.5 ${
                currentStatus === 'PUBLISHED' ? 'bg-emerald-500/10 text-emerald-600' :
                currentStatus === 'PENDING_REVIEW' ? 'bg-amber-500/10 text-amber-600' :
                currentStatus === 'REJECTED' ? 'bg-red-500/10 text-red-600' :
                'bg-[var(--bg-subtle)] text-[var(--fg-faint)]'
              }`}>
                {currentStatus.replace('_', ' ')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
