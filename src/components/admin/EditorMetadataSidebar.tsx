'use client'

import React, { type KeyboardEvent, type RefObject } from 'react'
import Image from 'next/image'
import {
  Clock, ChevronDown, Tag, ImagePlus, X,
} from 'lucide-react'
import { readTimeLabel, wordCountFromContent } from '@/lib/readTime'
import {
  EDITORIAL_TIME_ZONE_LABEL,
  getEditorialScheduleMinInput,
} from '@/lib/editorialSchedule'

// ── Types ───────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; slug: string }
interface UserOption { id: string; name: string | null; role: string }

export interface SidebarProps {
  content: string
  status: string
  setStatus: (v: string) => void
  isWriter: boolean | undefined
  canEdit: boolean
  canPublish: boolean
  currentStatus: string
  users: UserOption[]
  selectedAuthorId: string
  setSelectedAuthorId: (v: string) => void
  scheduledAt: string
  setScheduledAt: (v: string) => void
  categoryId: string
  setCategoryId: (v: string) => void
  categories: Category[]
  coverImage: string
  setCoverImage: (v: string) => void
  coverFileRef: RefObject<HTMLInputElement | null>
  uploading: boolean
  coverError: string
  handleCoverUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  tags: string[]
  setTags: (v: string[]) => void
  tagInput: string
  setTagInput: (v: string) => void
  handleTagKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  slug: string
  setSlug: (v: string) => void
  scheduleAutosave: () => void
  statusRef: RefObject<string>
  selectedAuthorIdRef: RefObject<string>
  scheduledAtRef: RefObject<string>
  categoryIdRef: RefObject<string>
  coverImageRef: RefObject<string>
  tagsRef: RefObject<string[]>
  slugRef: RefObject<string>
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void
}

// ── Status display maps ──────────────────────────────────────────────────────

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

// ── Shared field primitives ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--fg-faint)] mb-1.5 mt-4 first:mt-0">
      {children}
    </p>
  )
}

function StyledSelect({
  value, onChange, disabled, children,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-9 text-[16px] sm:text-[13px] border border-[var(--border)] bg-[var(--bg)] dark:bg-[var(--bg)] text-[var(--fg)] rounded-md px-3 pr-8 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 appearance-none cursor-pointer disabled:opacity-50 transition-colors"
      >
        {children}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
    </div>
  )
}

function StyledInput({
  value, onChange, placeholder, type = 'text', disabled, className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full h-9 text-[16px] sm:text-[13px] border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] rounded-md px-3 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 placeholder:text-[var(--fg-faint)] disabled:opacity-50 transition-colors ${className}`}
    />
  )
}

// ── Fields body ──────────────────────────────────────────────────────────────

function FieldsBody(props: Omit<SidebarProps, 'settingsOpen' | 'setSettingsOpen'>) {
  const {
    content, status, setStatus, isWriter, canEdit, canPublish, currentStatus,
    users, selectedAuthorId, setSelectedAuthorId,
    scheduledAt, setScheduledAt, categoryId, setCategoryId, categories,
    coverImage, setCoverImage, coverFileRef, uploading, coverError,
    handleCoverUpload, tags, setTags, tagInput, setTagInput, handleTagKeyDown,
    slug, setSlug, scheduleAutosave,
    statusRef, selectedAuthorIdRef, scheduledAtRef, categoryIdRef,
    coverImageRef, tagsRef, slugRef,
  } = props

  return (
    <div className="divide-y divide-[var(--border)]">

      {/* Stats row */}
      <div className="pb-3 mb-1">
        <div className="flex items-center gap-2">
          <Clock size={11} className="text-[var(--fg-faint)] shrink-0" />
          <span className="text-[11px] text-[var(--fg-faint)] tracking-wide">
            {content.length > 2 ? readTimeLabel(content) : '- min read'}
          </span>
          {content.length > 2 && (
            <>
              <span className="text-[var(--border)]">·</span>
              <span className="text-[11px] text-[var(--fg-faint)] tracking-wide">
                {wordCountFromContent(content).toLocaleString()} words
              </span>
            </>
          )}
        </div>
      </div>

      <div className="py-3 space-y-0">
        {/* Status */}
        <SectionLabel>Status</SectionLabel>
        {!isWriter ? (
          <StyledSelect
            value={status}
            onChange={(v) => { setStatus(v); statusRef.current = v; scheduleAutosave() }}
          >
            <option value="DRAFT">Draft</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            {canPublish && <option value="PUBLISHED">Published</option>}
            {canPublish && <option value="SCHEDULED">Scheduled</option>}
            <option value="ARCHIVED">Archived</option>
          </StyledSelect>
        ) : (
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border rounded-md ${STATUS_COLOURS[currentStatus] ?? STATUS_COLOURS.DRAFT}`}>
            {STATUS_LABELS[currentStatus] ?? currentStatus}
          </span>
        )}

        {/* Author */}
        {!isWriter && users.length > 0 && (
          <>
            <SectionLabel>Author</SectionLabel>
            <StyledSelect
              value={selectedAuthorId}
              onChange={(v) => { setSelectedAuthorId(v); selectedAuthorIdRef.current = v; scheduleAutosave() }}
              disabled={!canEdit}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.id}
                  {u.role !== 'WRITER' ? ` (${u.role.charAt(0) + u.role.slice(1).toLowerCase()})` : ''}
                </option>
              ))}
            </StyledSelect>
          </>
        )}

        {/* Schedule date */}
        {!isWriter && status === 'SCHEDULED' && (
          <>
            <SectionLabel>Publish At ({EDITORIAL_TIME_ZONE_LABEL})</SectionLabel>
            <input
              type="datetime-local"
              value={scheduledAt}
              min={getEditorialScheduleMinInput()}
              onChange={(e) => { setScheduledAt(e.target.value); scheduledAtRef.current = e.target.value; scheduleAutosave() }}
              className="w-full h-9 text-[16px] sm:text-[13px] border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] rounded-md px-3 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 cursor-pointer transition-colors"
            />
            <p className="text-[10px] text-[var(--fg-faint)] mt-1">UK editorial time.</p>
            {!scheduledAt && <p className="text-amber-500 text-[10px] mt-1">Pick a future date and time.</p>}
          </>
        )}

        {/* Category */}
        <SectionLabel>Category</SectionLabel>
        <StyledSelect
          value={categoryId}
          onChange={(v) => { setCategoryId(v); categoryIdRef.current = v; scheduleAutosave() }}
          disabled={!canEdit}
        >
          <option value="">No category</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </StyledSelect>
      </div>

      {/* Cover image */}
      <div className="py-3">
        <SectionLabel>Cover Image</SectionLabel>
        <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
        <StyledInput
          type="url"
          value={coverImage}
          onChange={(v) => { setCoverImage(v); coverImageRef.current = v; scheduleAutosave() }}
          placeholder="https://..."
          disabled={!canEdit}
        />
        {uploading && <p className="text-[10px] text-[var(--fg-faint)] mt-1">Uploading...</p>}
        {coverError && <p className="text-[10px] text-red-500 mt-1">{coverError}</p>}
        {coverImage && (
          <div className="mt-2 relative rounded-md overflow-hidden border border-[var(--border)]">
            <div className="relative w-full h-20 bg-[var(--bg-subtle)]">
              <Image
                src={coverImage}
                alt="Cover preview"
                fill
                className="object-cover"
                sizes="290px"
                unoptimized
              />
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => { setCoverImage(''); coverImageRef.current = ''; scheduleAutosave() }}
                className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80 transition-colors"
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
            className="mt-2 w-full h-8 text-[11px] border border-dashed border-[var(--border)] rounded-md text-[var(--fg-faint)] hover:border-gold hover:text-gold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <ImagePlus size={11} />
            {uploading ? 'Uploading...' : 'Upload file'}
          </button>
        )}
        <p className="text-[10px] text-[var(--fg-faint)] mt-1.5 leading-snug">
          Landscape, min 1200px wide, subject centred.
        </p>
      </div>

      {/* Tags */}
      <div className="py-3">
        <SectionLabel>
          <span className="inline-flex items-center gap-1">
            <Tag size={9} />
            Tags
          </span>
        </SectionLabel>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.map((t) => (
              <span key={t} className="flex items-center gap-0.5 text-[10px] px-2 py-1 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-full text-[var(--fg-muted)]">
                {t}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = tags.filter((x) => x !== t)
                      setTags(next)
                      tagsRef.current = next
                      scheduleAutosave()
                    }}
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
            onBlur={() => tagInput && handleTagKeyDown({ key: 'Enter', preventDefault: () => {} } as KeyboardEvent<HTMLInputElement>)}
            placeholder={tags.length < 10 ? 'Add tag, press Enter...' : 'Max 10 tags'}
            disabled={tags.length >= 10}
            className="w-full h-9 text-[16px] sm:text-[13px] border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] rounded-md px-3 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 placeholder:text-[var(--fg-faint)] disabled:opacity-50 transition-colors"
          />
        )}
        <p className="text-[10px] text-[var(--fg-faint)] mt-1">Separate with Enter or comma. Up to 10.</p>
      </div>

      {/* Slug */}
      {!isWriter && (
        <div className="py-3">
          <SectionLabel>URL Slug</SectionLabel>
          <StyledInput
            value={slug}
            onChange={(v) => { setSlug(v); slugRef.current = v; scheduleAutosave() }}
            placeholder="url-slug"
            className="font-mono text-[12px]"
          />
        </div>
      )}
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

export function EditorMetadataSidebar(props: SidebarProps) {
  const { settingsOpen, setSettingsOpen, ...rest } = props

  return (
    <>
      {/* Desktop right panel (hidden below 1100px) */}
      <div className="hidden min-[1100px]:flex flex-none w-[290px] sticky top-24 self-start">
        <div className="w-full bg-[var(--bg-elevated)] dark:bg-[#1e1e1e] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-subtle)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--fg-faint)]">
              Document Settings
            </p>
          </div>
          <div className="p-4">
            <FieldsBody {...rest} />
          </div>
        </div>
      </div>

      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40 transition-opacity duration-300 min-[1100px]:hidden"
        style={{
          opacity: settingsOpen ? 1 : 0,
          pointerEvents: settingsOpen ? 'auto' : 'none',
        }}
        onClick={() => setSettingsOpen(false)}
        aria-hidden
      />

      {/* Mobile bottom sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-[61] bg-[var(--bg-elevated)] dark:bg-[#1e1e1e] rounded-t-2xl shadow-2xl overflow-hidden flex flex-col min-[1100px]:hidden"
        style={{
          maxHeight: '82vh',
          transform: settingsOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}
        aria-hidden={!settingsOpen}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-sm font-semibold text-[var(--fg)]">Document settings</span>
          <button
            onClick={() => setSettingsOpen(false)}
            className="text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors p-1.5 rounded-md hover:bg-[var(--bg-subtle)]"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-4 flex-1">
          <FieldsBody {...rest} />
        </div>
      </div>
    </>
  )
}
