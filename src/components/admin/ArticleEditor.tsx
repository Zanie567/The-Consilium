'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Save, Send, Eye } from 'lucide-react'
import slugify from 'slugify'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="h-96 bg-cream-dark animate-pulse" /> }
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
  }
  categories: Category[]
  authorId: string
  canPublish: boolean
  returnUrl?: string
}

export function ArticleEditor({
  articleId,
  initialData,
  categories,
  authorId,
  canPublish,
  returnUrl,
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setTitle(val)
    if (!articleId) {
      setSlug(
        slugify(val, { lower: true, strict: true, trim: true })
      )
    }
  }

  const handleContentChange = useCallback((c: string) => {
    setContent(c)
  }, [])

  const handleSave = async (overrideStatus?: string) => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')

    const body = {
      title,
      slug,
      content,
      excerpt,
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
      setSuccess('Article saved successfully.')
      if (!articleId) {
        router.push(returnUrl ? `${returnUrl}/${saved.id}/edit` : `/admin/articles/${saved.id}/edit`)
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
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold text-navy"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {articleId ? 'Edit Article' : 'New Article'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {articleId && status === 'PUBLISHED' && (
            <a
              href={`/articles/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-navy/60 text-xs border border-navy/20 px-3 py-2 hover:bg-cream-dark transition-colors"
            >
              <Eye size={14} />
              Preview
            </a>
          )}
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-white border border-navy text-navy text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-cream-dark transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            Save Draft
          </button>
          {canPublish && (
            <button
              onClick={() =>
                handleSave(status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')
              }
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-navy text-gold text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-navy-dark transition-colors disabled:opacity-50"
            >
              <Send size={14} />
              {status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
            </button>
          )}
          {!canPublish && (
            <button
              onClick={() => handleSave('PENDING_REVIEW')}
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-amber-600 text-white text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              <Send size={14} />
              Submit for Review
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 px-4 py-3 text-green-700 text-sm">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main editor */}
        <div className="lg:col-span-2 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-2">
              Title <span className="text-gold">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder="Article title"
              className="w-full border border-navy/20 px-4 py-3 text-navy text-base font-semibold focus:outline-none focus:border-gold bg-white"
              style={{ fontFamily: 'var(--font-serif)' }}
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-2">
              URL Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="url-slug"
              className="w-full border border-navy/20 px-4 py-2.5 text-navy text-sm font-mono focus:outline-none focus:border-gold bg-white"
            />
          </div>

          {/* Excerpt */}
          <div>
            <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-2">
              Excerpt
            </label>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="A brief summary of the article..."
              rows={3}
              className="w-full border border-navy/20 px-4 py-3 text-navy text-sm focus:outline-none focus:border-gold bg-white resize-none"
            />
          </div>

          {/* Content Editor */}
          <div>
            <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-2">
              Content <span className="text-gold">*</span>
            </label>
            <TiptapEditor content={content} onChange={handleContentChange} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Status */}
          <div className="bg-white border border-gold/15 p-4">
            <h3 className="text-navy text-xs font-bold uppercase tracking-widest mb-3">
              Status
            </h3>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-navy/20 px-3 py-2 text-navy text-sm focus:outline-none focus:border-gold bg-cream"
            >
              <option value="DRAFT">Draft</option>
              {canPublish && (
                <option value="PUBLISHED">Published</option>
              )}
              <option value="PENDING_REVIEW">Pending Review</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          {/* Category */}
          <div className="bg-white border border-gold/15 p-4">
            <h3 className="text-navy text-xs font-bold uppercase tracking-widest mb-3">
              Category
            </h3>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full border border-navy/20 px-3 py-2 text-navy text-sm focus:outline-none focus:border-gold bg-cream"
            >
              <option value="">No Category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Cover Image */}
          <div className="bg-white border border-gold/15 p-4">
            <h3 className="text-navy text-xs font-bold uppercase tracking-widest mb-3">
              Cover Image URL
            </h3>
            <input
              type="url"
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="https://..."
              className="w-full border border-navy/20 px-3 py-2 text-navy text-sm focus:outline-none focus:border-gold bg-cream"
            />
            {coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverImage}
                alt="Cover preview"
                className="mt-3 w-full h-32 object-cover border border-navy/10"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
