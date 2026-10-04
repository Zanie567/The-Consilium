'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Check, AlertCircle, Loader2, Upload, X } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { getInitials } from '@/lib/authorUtils'
import { detectImageMimeType } from '@/lib/imageSniff'

interface SavedProfile {
  bio: string | null
  image: string | null
}

interface TeamProfileFormProps {
  /** Account name; read-only here, edited in account settings. */
  name: string
  /** Display label of the team derived from the account's role. Read-only. */
  teamLabel: string
  profile: SavedProfile | null
  maxBioLength: number
  maxPhotoBytes: number
}

const ACCEPTED = 'image/jpeg,image/png,image/gif,image/webp,image/avif'
const labelClass = 'block text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-1.5'

export function TeamProfileForm({
  name,
  teamLabel,
  profile,
  maxBioLength,
  maxPhotoBytes,
}: TeamProfileFormProps) {
  const router = useRouter()
  const [exists, setExists] = useState(profile !== null)
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [image, setImage] = useState(profile?.image ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  // A ref, not just state: two clicks in the same tick both see `saving === false`
  // until React re-renders, and each would send a request.
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) return
    let active = true
    let url: string | undefined
    // Never ask the browser to decode arbitrary bytes as a preview. Keep the file
    // for authoritative server validation, but preview only a recognised image.
    void file.slice(0, 32).arrayBuffer().then(bytes => {
      if (!active || !detectImageMimeType(new Uint8Array(bytes))) return
      url = URL.createObjectURL(file)
      setPreview(url)
    })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  const chooseFile = (next: File | null) => {
    setStatus(null)
    if (!next) return
    if (next.size > maxPhotoBytes) {
      setStatus({ ok: false, message: `That photo is too large (max ${maxPhotoBytes / (1024 * 1024)} MB).` })
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setFile(next)
    setPreview(null)
    setRemoveImage(false)
  }

  const clearPhoto = () => {
    setFile(null)
    setPreview(null)
    setRemoveImage(true)
    if (fileInput.current) fileInput.current.value = ''
  }

  const shownImage = preview ?? (removeImage ? null : image)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setStatus(null)
    try {
      const body = new FormData()
      body.set('bio', bio)
      if (file) body.set('image', file)
      else if (removeImage) body.set('removeImage', 'true')

      const saved = await apiRequest<SavedProfile>('/api/team-profile', { method: 'PUT', body })
      setExists(true)
      setBio(saved.bio ?? '')
      setImage(saved.image)
      setFile(null)
      setPreview(null)
      setRemoveImage(false)
      if (fileInput.current) fileInput.current.value = ''
      setStatus({ ok: true, message: 'Your team profile has been saved.' })
      router.refresh()
    } catch (reason) {
      setStatus({ ok: false, message: asApiError(reason).message })
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <div className="flex items-center gap-5">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-navy">
          {shownImage ? (
            preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview
              <img src={preview} alt="New profile photo preview" className="h-full w-full object-cover" />
            ) : (
              <Image src={shownImage} alt="Your profile photo" width={96} height={96} className="h-full w-full object-cover" />
            )
          ) : (
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-gold"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {getInitials(name)}
            </span>
          )}
        </div>
        <div className="space-y-2">
          <input
            ref={fileInput}
            id="tp-photo"
            type="file"
            accept={ACCEPTED}
            className="sr-only"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            disabled={saving}
          />
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor="tp-photo"
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 border border-[var(--border-strong)] px-4 text-xs font-bold uppercase tracking-widest text-[var(--fg)] hover:border-gold"
            >
              <Upload size={14} aria-hidden="true" />
              {shownImage ? 'Change photo' : 'Upload photo'}
            </label>
            {shownImage && (
              <button
                type="button"
                onClick={clearPhoto}
                disabled={saving}
                className="inline-flex min-h-[44px] items-center gap-2 px-3 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:text-red-500"
              >
                <X size={14} aria-hidden="true" />
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-[var(--fg-faint)]">
            JPEG, PNG, GIF, WebP or AVIF, up to {maxPhotoBytes / (1024 * 1024)} MB.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <span className={labelClass}>Name</span>
          <p className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--fg)]">{name}</p>
          <p className="mt-1 text-xs text-[var(--fg-faint)]">Taken from your account.</p>
        </div>
        <div>
          <span className={labelClass}>Team</span>
          <p className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--fg)]">{teamLabel}</p>
          <p className="mt-1 text-xs text-[var(--fg-faint)]">Set by your role. It can&apos;t be changed here.</p>
        </div>
      </div>

      <div>
        <label htmlFor="tp-bio" className={labelClass}>Description</label>
        <textarea
          id="tp-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={maxBioLength}
          rows={6}
          disabled={saving}
          placeholder="A few sentences on what you do at The Consilium."
          className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-gold focus:outline-none"
        />
        <p className="mt-1 text-right text-xs text-[var(--fg-faint)]">
          {bio.length}/{maxBioLength}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-[44px] items-center gap-2 bg-navy px-6 text-xs font-bold uppercase tracking-widest text-cream transition-colors hover:bg-navy/90 disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {saving ? 'Saving…' : exists ? 'Save changes' : 'Create profile'}
        </button>
        <p role="status" aria-live="polite" // No colour until there is a message: an empty status must not start out error-red,
          // or a successful save fades from red to green.
          className={`flex items-center gap-2 text-sm ${status ? (status.ok ? 'text-emerald-600' : 'text-red-500') : ''}`}>
          {status && (status.ok ? <Check size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />)}
          {status?.message}
        </p>
      </div>
    </form>
  )
}
