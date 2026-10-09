'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, apiRequest, asApiError } from '@/lib/apiClient'
import { TEAM_TIER_ORDER, type TeamTierId } from '@/lib/teamHierarchy'
import { getInitials } from '@/lib/authorUtils'
import { MAX_BIO_LENGTH } from '@/lib/constants'
import type { MemberCard } from '@/lib/membership'

export const TIER_LABEL: Record<TeamTierId, string> = {
  editor_in_chief: 'Editor-in-Chief',
  deputy: 'Deputy Editor-in-Chief',
  leadership: 'Leadership',
  senior_editor: 'Senior editor',
  editor: 'Editor',
  junior_editor: 'Junior editor',
  writer: 'Writer',
  growth: 'Growth & Communications',
  other: 'Wider team',
}
export const TIERS = [
  { value: '', label: 'Follow the public position' },
  ...TEAM_TIER_ORDER.map((value) => ({ value, label: TIER_LABEL[value] })),
]

export const fieldClass =
  'w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-gold focus:outline-none disabled:opacity-60'
export const labelClass = 'block text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-1'
export const buttonClass =
  'inline-flex min-h-[40px] items-center justify-center px-4 text-xs font-bold uppercase tracking-widest disabled:opacity-60'

interface FormState {
  name: string
  position: string
  tier: string
  bio: string
  image: string
  email: string
  order: string
  visible: boolean
}

const fromCard = (card: MemberCard | null, defaultName: string): FormState => ({
  name: card?.name ?? defaultName,
  position: card?.position ?? '',
  tier: card?.publicTier ?? '',
  bio: card?.bio ?? '',
  image: card?.image ?? '',
  email: card?.email ?? '',
  order: card ? String(card.order) : '1000',
  visible: card?.visible ?? false,
})

interface Props {
  /** The existing card to edit, or null to create one. */
  card: MemberCard | null
  /** Create mode only: the account the new profile is created for and linked to. */
  linkToUserId?: string | null
  defaultName?: string
  /** Called after a successful save so the parent can reload the directory. */
  onSaved: (message: string) => Promise<void> | void
  /** Reports unsaved edits so the parent can warn before the panel is closed. */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * One form for every way an administrator edits a Meet the Team profile: name, public
 * position and placement, biography, photo, order and visibility, with a live preview. The
 * permission role is deliberately absent: changing a title here can never grant access.
 */
export function TeamProfileEditor({ card, linkToUserId = null, defaultName = '', onSaved, onDirtyChange }: Props) {
  const initial = useMemo(() => fromCard(card, defaultName), [card, defaultName])
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<{ text: string; duplicateName?: boolean } | null>(null)
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // A reload after a save hands in a fresh card (new updatedAt): adopt it.
  useEffect(() => { setForm(initial) }, [initial])

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  useEffect(() => {
    onDirtyChange?.(dirty)
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, onDirtyChange])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const input = event.currentTarget
    if (!file) return
    setUploading(true)
    setError(null)
    const data = new FormData()
    data.append('file', file)
    data.append('bucket', 'avatars')
    try {
      const { url } = await apiRequest<{ url?: string }>('/api/upload', { method: 'POST', body: data })
      if (!url) throw new ApiError('server', 'The upload finished without returning an image address.')
      set('image', url)
    } catch (reason) {
      setError({ text: `Photo not changed. ${asApiError(reason).message}` })
    } finally {
      setUploading(false)
      input.value = ''
    }
  }

  async function save(allowDuplicateName = false) {
    if (inFlight.current) return
    const order = form.order.trim() === '' ? undefined : Number(form.order)
    if (order !== undefined && (!Number.isInteger(order) || order < 0 || order > 9999)) {
      setError({ text: 'Display order must be a whole number from 0 to 9999.' })
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    const body = {
      name: form.name,
      position: form.position,
      publicTier: form.tier || null,
      bio: form.bio,
      image: form.image || null,
      email: form.email || null,
      ...(order !== undefined ? { order } : {}),
      visible: form.visible,
    }
    try {
      if (card) {
        await apiRequest(`/api/team/${card.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, expectedUpdatedAt: card.updatedAt }),
        })
        await onSaved('Public details saved.')
      } else {
        await apiRequest('/api/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, ...(linkToUserId ? { userId: linkToUserId } : {}), ...(allowDuplicateName ? { allowDuplicateName: true } : {}) }),
        })
        await onSaved(linkToUserId ? 'Profile created and linked to the account.' : 'Profile created.')
      }
    } catch (reason) {
      const apiError = asApiError(reason)
      setError({ text: apiError.message, duplicateName: apiError.code === 'DUPLICATE_NAME' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const bioLeft = MAX_BIO_LENGTH - form.bio.length
  const id = card?.id ?? 'new'

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <form
        onSubmit={(e) => { e.preventDefault(); void save() }}
        aria-label={card ? 'Edit public profile' : 'Create public profile'}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`pf-name-${id}`} className={labelClass}>Name</label>
            <input id={`pf-name-${id}`} required maxLength={100} value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={`pf-position-${id}`} className={labelClass}>Public position</label>
            <input id={`pf-position-${id}`} maxLength={100} value={form.position} onChange={(e) => set('position', e.target.value)} placeholder="e.g. Editor-in-Chief" className={fieldClass} />
          </div>
          <div>
            <label htmlFor={`pf-tier-${id}`} className={labelClass}>Public placement</label>
            <select id={`pf-tier-${id}`} value={form.tier} onChange={(e) => set('tier', e.target.value)} className={fieldClass}>
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`pf-order-${id}`} className={labelClass}>Display order</label>
            <input id={`pf-order-${id}`} type="number" min={0} max={9999} value={form.order} onChange={(e) => set('order', e.target.value)} className={fieldClass} />
          </div>
        </div>

        <div>
          <label htmlFor={`pf-bio-${id}`} className={labelClass}>Biography</label>
          <textarea id={`pf-bio-${id}`} rows={4} value={form.bio} onChange={(e) => set('bio', e.target.value)} className={fieldClass} aria-describedby={`pf-bio-count-${id}`} />
          <p id={`pf-bio-count-${id}`} className={`mt-1 text-xs ${bioLeft < 0 ? 'text-red-500' : 'text-[var(--fg-muted)]'}`}>
            {bioLeft < 0 ? `${-bioLeft} characters too many` : `${bioLeft} characters left`}
          </p>
        </div>

        <div>
          <span className={labelClass}>Photo</span>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={uploading || busy} onClick={() => fileInput.current?.click()} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>
              {uploading ? 'Uploading…' : form.image ? 'Replace photo' : 'Upload photo'}
            </button>
            {form.image && (
              <button type="button" disabled={uploading || busy} onClick={() => set('image', '')} className={`${buttonClass} text-[var(--fg-muted)]`}>Remove photo</button>
            )}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Photo file" tabIndex={-1} onChange={upload} />
          </div>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">JPEG, PNG or WebP. The change is saved with the rest of the profile.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`pf-email-${id}`} className={labelClass}>Contact email on the card (optional)</label>
            <input id={`pf-email-${id}`} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={fieldClass} />
          </div>
          <div className="flex items-end">
            <label className="flex min-h-[40px] items-center gap-2 text-sm text-[var(--fg)]">
              <input type="checkbox" checked={form.visible} onChange={(e) => set('visible', e.target.checked)} />
              Show on Our Team page
            </label>
          </div>
        </div>

        {error && (
          <div role="alert" className="border border-red-500/40 p-3 text-sm text-red-500">
            <p>{error.text}</p>
            {error.duplicateName && (
              <button type="button" disabled={busy} onClick={() => void save(true)} className={`${buttonClass} mt-2 border border-red-500/50`}>
                This is a different person. Create anyway
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || uploading || !form.name.trim() || (!!card && !dirty)} className={`${buttonClass} bg-navy text-cream hover:bg-navy/90`}>
            {busy ? 'Saving…' : card ? 'Save public details' : 'Create profile'}
          </button>
          {dirty && !busy && <span className="text-xs text-amber-600" role="status">Unsaved changes</span>}
          {dirty && card && (
            <button type="button" disabled={busy} onClick={() => { setForm(initial); setError(null) }} className={`${buttonClass} text-[var(--fg-muted)]`}>Discard changes</button>
          )}
        </div>
      </form>

      <aside aria-label="Preview" className="self-start border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">Preview</p>
        <div className="flex flex-col items-center text-center">
          {form.image ? (
            // A plain img: the preview must show exactly what was typed or uploaded, including URLs
            // the image optimiser has not been told about.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.image} alt="" className="h-24 w-24 rounded-full object-cover ring-2 ring-gold/30" />
          ) : (
            <div aria-hidden className="flex h-24 w-24 items-center justify-center rounded-full bg-navy text-xl font-bold text-gold">
              {getInitials(form.name || '?')}
            </div>
          )}
          <p className="mt-3 font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{form.name || 'Name'}</p>
          <p className="text-xs uppercase tracking-widest text-gold">{form.position || 'No public position'}</p>
          <p className="mt-2 line-clamp-5 text-xs text-[var(--fg-muted)]">{form.bio || 'No biography yet.'}</p>
          <p className={`mt-3 text-[10px] font-bold uppercase tracking-widest ${form.visible && form.name && form.position && form.bio ? 'text-emerald-600' : 'text-amber-600'}`}>
            {form.visible
              ? form.name && form.position && form.bio ? 'Will show publicly' : 'Visible, but hidden until name, position and biography are set'
              : 'Hidden from the public page'}
          </p>
        </div>
      </aside>
    </div>
  )
}
