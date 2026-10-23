'use client'

import Image from 'next/image'
import { useEffect, useId, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  coverFramingImageStyle, defaultCoverFraming,
  type CoverBannerHeight, type CoverFit, type CoverFraming,
} from '@/lib/coverFraming'

const HEIGHTS: { value: CoverBannerHeight; label: string }[] = [
  { value: 'compact', label: 'Short' },
  { value: 'standard', label: 'Standard' },
  { value: 'tall', label: 'Tall' },
]

const FOCUS = [
  { x: 0, y: 0, label: 'Top left' },
  { x: 50, y: 0, label: 'Top centre' },
  { x: 100, y: 0, label: 'Top right' },
  { x: 0, y: 50, label: 'Middle left' },
  { x: 50, y: 50, label: 'Centre' },
  { x: 100, y: 50, label: 'Middle right' },
  { x: 0, y: 100, label: 'Bottom left' },
  { x: 50, y: 100, label: 'Bottom centre' },
  { x: 100, y: 100, label: 'Bottom right' },
] as const

function previewHeight(height: CoverBannerHeight, phone: boolean): number {
  return phone
    ? { compact: 145, standard: 165, tall: 195 }[height]
    : { compact: 92, standard: 124, tall: 159 }[height]
}

export function CoverFramingEditor({
  articleId, coverImage, canEdit,
}: { articleId?: string; coverImage: string; canEdit: boolean }) {
  const zoomId = useId()
  const [framing, setFraming] = useState<CoverFraming>(() => defaultCoverFraming(coverImage))
  const [preview, setPreview] = useState<'desktop' | 'phone'>('desktop')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setFraming(defaultCoverFraming(coverImage))
    setError('')
    setNotice('')
    if (!articleId || !coverImage) return
    setLoading(true)
    void fetch(`/api/editorial/articles/${encodeURIComponent(articleId)}/cover-framing`, { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as { framing?: CoverFraming; error?: string }
        if (!response.ok) throw new Error(data.error || 'Could not load saved framing.')
        if (active && data.framing?.imageUrl === coverImage) setFraming(data.framing)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load saved framing.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [articleId, coverImage])

  if (!coverImage) return null

  const editable = canEdit && !loading && !saving
  const patch = (change: Partial<CoverFraming>) => {
    setFraming((current) => ({ ...current, ...change, imageUrl: coverImage }))
    setNotice('')
  }

  const save = async () => {
    if (!articleId || !editable) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/editorial/articles/${encodeURIComponent(articleId)}/cover-framing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(framing),
      })
      const data = (await response.json()) as { error?: string; framing?: CoverFraming; cacheRefreshed?: boolean }
      if (!response.ok) throw new Error(data.error || 'Unable to save.')
      if (data.framing) setFraming(data.framing)
      setNotice(data.cacheRefreshed === false
        ? 'Banner framing saved, but public cache refresh failed. The previous crop may briefly remain visible.'
        : 'Banner framing saved. Published articles will use this view.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Cover image framing" className="mt-4 pt-4 border-t border-[var(--border)] space-y-3">
      <div>
        <h3 className="text-[12px] font-semibold text-[var(--fg)]">Banner image framing</h3>
        <p className="text-[11px] text-[var(--fg-muted)] leading-snug mt-1">
          Choose what fits the article. Preview your crop and focal point before saving.
        </p>
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Preview screen size">
        {(['desktop', 'phone'] as const).map((device) => (
          <button key={device} type="button" onClick={() => setPreview(device)}
            aria-pressed={preview === device}
            className={`px-2.5 py-1.5 border text-[11px] rounded ${preview === device
              ? 'border-gold text-gold bg-gold/5' : 'border-[var(--border)] text-[var(--fg-muted)]'}`}>
            {device === 'desktop' ? 'Desktop preview' : 'Phone preview'}
          </button>
        ))}
      </div>

      <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded p-2">
        <div className="relative overflow-hidden mx-auto bg-navy/10 dark:bg-navy/20 rounded-sm"
          aria-label={`${preview === 'phone' ? 'Phone' : 'Desktop'} banner preview at ${framing.zoom}% zoom`}
          style={{
            width: preview === 'phone' ? 'min(100%, 180px)' : '100%',
            height: previewHeight(framing.height, preview === 'phone'),
          }}>
          <Image src={coverImage} alt="Current banner crop preview" fill unoptimized sizes="320px"
            draggable={false} style={coverFramingImageStyle(framing)} />
        </div>
      </div>

      <div>
        <span className="text-[11px] text-[var(--fg-muted)] block mb-1">Image fit</span>
        <div role="group" aria-label="Banner image fit" className="flex gap-1.5">
          {([
            ['contain', 'Fit entire image'],
            ['cover', 'Fill banner'],
          ] as const satisfies readonly (readonly [CoverFit, string])[]).map(([fit, label]) => (
            <button type="button" key={fit} disabled={!editable}
              aria-pressed={framing.fit === fit} onClick={() => patch({ fit })}
              className={`flex-1 border rounded px-2 py-2 text-[11px] disabled:opacity-50 ${framing.fit === fit
                ? 'border-gold text-gold bg-gold/5' : 'border-[var(--border)] text-[var(--fg-muted)]'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[var(--fg-faint)] mt-1">
          Fit preserves all edges. Fill crops automatically to the banner shape.
        </p>
      </div>

      <div>
        <label htmlFor={zoomId} className="flex justify-between text-[11px] text-[var(--fg-muted)]">
          <span>Zoom</span><span className="tabular-nums">{framing.zoom}%</span>
        </label>
        <input id={zoomId} aria-label="Banner image zoom"
          type="range" min={100} max={200} step={5}
          value={framing.zoom} disabled={!editable}
          onChange={(event) => patch({ zoom: Number(event.target.value) })}
          className="w-full accent-[#c9a227] disabled:opacity-50" />
        <div className="flex justify-between text-[10px] text-[var(--fg-faint)]">
          <span>100% · natural</span><span>200% · close-up</span>
        </div>
      </div>

      <div>
        <span className="text-[11px] text-[var(--fg-muted)] block mb-1">Focal point</span>
        <div className="flex items-center gap-3">
          <div className="grid grid-cols-3 gap-1 p-1 border border-[var(--border)] rounded"
            role="group" aria-label="Choose where the banner is centred">
            {FOCUS.map(({ x, y, label }) => {
              const active = framing.focusX === x && framing.focusY === y
              return (
                <button type="button" key={label} disabled={!editable}
                  aria-label={`Focus ${label.toLowerCase()}`} aria-pressed={active}
                  onClick={() => patch({ focusX: x, focusY: y })}
                  className={`w-7 h-7 border rounded flex items-center justify-center disabled:opacity-50 ${active
                    ? 'border-gold bg-gold/10 text-gold' : 'border-[var(--border)] text-[var(--fg-faint)]'}`}>
                  <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-gold' : 'bg-current opacity-50'}`} />
                </button>
              )
            })}
          </div>
          <p className="text-[10px] leading-snug text-[var(--fg-faint)] flex-1">
            Pick the part of the image to keep in view when cropped or zoomed. Changes show above immediately.
          </p>
        </div>
      </div>

      <div>
        <span className="text-[11px] text-[var(--fg-muted)] block mb-1">Banner height</span>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Banner height">
          {HEIGHTS.map(({ value, label }) => (
            <button key={value} type="button" disabled={!editable}
              onClick={() => patch({ height: value })} aria-pressed={framing.height === value}
              className={`px-1 py-2 border rounded text-[11px] disabled:opacity-50 ${framing.height === value
                ? 'border-gold text-gold bg-gold/5' : 'border-[var(--border)] text-[var(--fg-muted)]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" disabled={!editable || !articleId}
          onClick={() => void save()}
          className="flex-1 px-3 py-2 text-[11px] font-semibold border border-gold/50 text-gold rounded disabled:opacity-40">
          {saving ? 'Saving…' : 'Save banner framing'}
        </button>
        <button type="button" disabled={!editable} title="Restore default framing"
          aria-label="Reset banner framing to defaults"
          onClick={() => patch(defaultCoverFraming(coverImage))}
          className="p-2 border border-[var(--border)] rounded disabled:opacity-50">
          <RotateCcw size={14} />
        </button>
      </div>
      {!articleId && <p className="text-[11px] text-[var(--fg-muted)]">
        Save the article as a draft first to store its banner settings.
      </p>}
      {!canEdit && <p className="text-[11px] text-[var(--fg-muted)]">
        Framing is read-only for this article. Writers can adjust their own editable drafts; editors handle published articles.
      </p>}
      {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
      {notice && <p role="status" className="text-[11px] text-[var(--fg-muted)]">{notice}</p>}
      <p className="text-[10px] text-[var(--fg-faint)]">Previews are approximate: visible cropping varies by screen size.</p>
    </section>
  )
}
