'use client'

import { useEffect, useState, type FormEvent } from 'react'

interface CoverMetadata {
  imageUrl: string
  caption: string
  source: string
  sourceUrl: string
}

export function CoverAttributionEditor({
  articleId, coverImage, canEdit,
}: { articleId?: string; coverImage: string; canEdit: boolean }) {
  const [caption, setCaption] = useState('')
  const [source, setSource] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setCaption('')
    setSource('')
    setSourceUrl('')
    setNotice('')
    setError('')
    if (!articleId || !coverImage) return
    let active = true
    setLoading(true)
    void fetch(`/api/editorial/articles/${encodeURIComponent(articleId)}/cover-metadata`, { cache: 'no-store' })
      .then(async (response) => {
        const result = (await response.json()) as { metadata?: CoverMetadata | null; error?: string }
        if (!response.ok) throw new Error(result.error || 'Cannot load image attribution.')
        if (!active || result.metadata?.imageUrl !== coverImage) return
        setCaption(result.metadata.caption)
        setSource(result.metadata.source)
        setSourceUrl(result.metadata.sourceUrl)
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load source.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [articleId, coverImage])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!articleId || !coverImage) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/editorial/articles/${encodeURIComponent(articleId)}/cover-metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: coverImage, caption, source, sourceUrl }),
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Unable to save image source.')
      setNotice('Caption and attribution saved. The published article displays them beneath the cover.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save image source.')
    } finally {
      setSaving(false)
    }
  }

  if (!coverImage) return null
  return (
    <form onSubmit={(event) => void save(event)} className="mt-3 border-t border-[var(--border)] pt-3 space-y-2" aria-label="Cover image attribution">
      <h3 className="text-xs font-semibold text-[var(--fg)]">Cover caption and source</h3>
      {!articleId ? (
        <p className="text-[11px] text-[var(--fg-muted)]">
          Save this article as a draft first, then add and save its cover attribution before publishing.
        </p>
      ) : (
        <>
          <label className="block">
            <span className="text-[11px] text-[var(--fg-muted)]">Caption *</span>
            <textarea aria-label="Cover image caption" required maxLength={500} rows={2}
              value={caption} disabled={!canEdit || loading || saving}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Describe what this image actually shows"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded p-2 text-[12px]" />
          </label>
          <label className="block">
            <span className="text-[11px] text-[var(--fg-muted)]">Source / photographer *</span>
            <input aria-label="Cover image source" required maxLength={250}
              value={source} disabled={!canEdit || loading || saving}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Photographer / agency / organisation"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded p-2 text-[12px]" />
          </label>
          <label className="block">
            <span className="text-[11px] text-[var(--fg-muted)]">Source URL (optional)</span>
            <input type="url" aria-label="Cover image source URL" maxLength={2048}
              value={sourceUrl} disabled={!canEdit || loading || saving}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded p-2 text-[12px]" />
          </label>
          <button type="submit" disabled={!canEdit || loading || saving || !caption.trim() || !source.trim()}
            className="border border-gold/50 px-3 py-1.5 rounded text-[11px] text-gold disabled:opacity-40">
            {saving ? 'Saving attribution…' : 'Save image attribution'}
          </button>
          <p className="text-[10px] text-[var(--fg-faint)] leading-snug">
            Saved separately from article text. Changes to a published cover appear publicly immediately.
            Replacing the image requires new attribution to prevent incorrect credits.
          </p>
          {notice && <p role="status" className="text-[11px] text-[var(--fg-muted)]">{notice}</p>}
          {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
        </>
      )}
    </form>
  )
}
