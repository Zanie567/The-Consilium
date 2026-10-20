'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Check, AlertCircle, Loader2, Upload, X } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { getInitials } from '@/lib/authorUtils'
import { detectImageMimeType } from '@/lib/imageSniff'
import { sameShared, type SharedField, type SharedProfileView } from '@/lib/profileFields'
import { DifferingDetails } from '@/components/profile/SharedProfileNotices'

interface SavedProfile {
  name?: string
  bio: string | null
  image: string | null
  profile: SharedProfileView
}

interface TeamProfileFormProps {
  /** Name, description and photo as saved (shared with the account), and any old differences. */
  view: SharedProfileView
  /** A card already exists (or a legacy card will be adopted): "Save changes" rather than "Create profile". */
  exists: boolean
  /** Used for initials and as the name when none is set yet. */
  fallbackName: string
  /** Trusted public title. Read-only: administrators set it. */
  positionLabel: string
  maxNameLength: number
  maxBioLength: number
  maxPhotoBytes: number
}

// The photo is also the account photo (bylines), so it follows the account photo rules.
const ACCEPTED = 'image/jpeg,image/png,image/webp'
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const labelClass = 'block text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-1.5'

export function TeamProfileForm({
  view,
  exists: initiallyExists,
  fallbackName,
  positionLabel,
  maxNameLength,
  maxBioLength,
  maxPhotoBytes,
}: TeamProfileFormProps) {
  const router = useRouter()
  const [exists, setExists] = useState(initiallyExists)
  // What the server last confirmed. It is sent back as the `expected` value of each changed field,
  // so a change saved elsewhere since (the account page, another tab, an administrator) is refused
  // instead of silently overwritten.
  const [savedView, setSavedView] = useState(view)
  const [name, setName] = useState(view.values.name ?? fallbackName)
  const [bio, setBio] = useState(view.values.bio ?? '')
  const image = savedView.values.image
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
    }).catch(() => {
      if (active) setStatus({ ok: false, message: 'Could not read that photo. Please choose it again.' })
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
    if (next.type && !ACCEPTED_TYPES.has(next.type)) {
      setStatus({ ok: false, message: 'Photos must be JPEG, PNG or WebP.' })
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
  const nameDirty = name.trim() !== '' && !sameShared(name, savedView.values.name)
  const bioDirty = !sameShared(bio, savedView.values.bio)

  /** Sends only the given changes, each with the value this page showed for it. */
  const send = async (changes: { name?: string; bio?: string; file?: File; removeImage?: boolean; imageUrl?: string }) => {
    const body = new FormData()
    const expect = (field: SharedField, key: string) => body.set(key, savedView.values[field] ?? '')
    if (changes.name !== undefined) { body.set('name', changes.name); expect('name', 'expectedName') }
    if (changes.bio !== undefined) { body.set('bio', changes.bio); expect('bio', 'expectedBio') }
    if (changes.file) { body.set('image', changes.file); expect('image', 'expectedImage') }
    else if (changes.removeImage) { body.set('removeImage', 'true'); expect('image', 'expectedImage') }
    else if (changes.imageUrl !== undefined) { body.set('imageUrl', changes.imageUrl); expect('image', 'expectedImage') }

    const saved = await apiRequest<SavedProfile>('/api/team-profile', { method: 'PUT', body })
    setExists(true)
    setSavedView(saved.profile)
    if (changes.name !== undefined) setName(saved.profile.values.name ?? fallbackName)
    if (changes.bio !== undefined) setBio(saved.profile.values.bio ?? '')
    if (changes.file || changes.removeImage || changes.imageUrl !== undefined) {
      setFile(null)
      setPreview(null)
      setRemoveImage(false)
      if (fileInput.current) fileInput.current.value = ''
    }
    router.refresh()
    return saved
  }

  const run = async (action: () => Promise<unknown>, message: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setStatus(null)
    try {
      await action()
      setStatus({ ok: true, message })
    } catch (reason) {
      setStatus({ ok: false, message: asApiError(reason).message })
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    void run(
      () => send({
        ...(nameDirty ? { name } : {}),
        ...(bioDirty ? { bio } : {}),
        ...(file ? { file } : removeImage ? { removeImage: true } : {}),
      }),
      'Your team profile has been saved. Your account shows the same details.',
    )
  }

  // A choice in "Some details still differ": saved straight away.
  const chooseVersion = (field: SharedField, value: string | null) =>
    void run(
      () => field === 'image'
        ? (value === null ? send({ removeImage: true }) : send({ imageUrl: value }))
        : send({ [field]: value ?? '' }),
      'Saved. That detail is now the same everywhere.',
    )

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <DifferingDetails
        view={savedView}
        busy={saving}
        onUseAccount={chooseVersion}
        onUseShown={(field) => chooseVersion(field, savedView.values[field])}
      />

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
              {getInitials(name || fallbackName)}
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
            JPEG, PNG or WebP, up to {maxPhotoBytes / (1024 * 1024)} MB. Also used as your account photo.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="tp-name" className={labelClass}>Name shown on the page</label>
        <input
          id="tp-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={maxNameLength}
          disabled={saving}
          autoComplete="name"
          className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-gold focus:outline-none"
        />
        <p className="mt-1 text-xs text-[var(--fg-faint)]">Use the name you&apos;d like readers to see, here and on your articles.</p>
      </div>

      <div>
        <span className={labelClass}>Public title</span>
        <p className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--fg)]">{positionLabel}</p>
        <p className="mt-1 text-xs text-[var(--fg-faint)]">Set by an administrator. It can&apos;t be changed here.</p>
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
        {(nameDirty || bioDirty || file || removeImage) && !saving && (
          <span className="text-xs text-amber-600">Unsaved changes</span>
        )}
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
