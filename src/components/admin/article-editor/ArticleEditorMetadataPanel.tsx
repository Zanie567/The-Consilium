'use client'

import type React from 'react'
import Image from 'next/image'
import { ChevronDown, Clock, ImagePlus, Tag, X } from 'lucide-react'
import { EDITORIAL_TIME_ZONE_LABEL, getEditorialScheduleMinInput } from '@/lib/editorialSchedule'
import { readTimeLabel, wordCountFromContent } from '@/lib/readTime'
import { STATUS_COLOURS, STATUS_LABELS } from './constants'
import type { ArticleEditorController } from './types'

interface ArticleEditorMetadataPanelProps {
  editor: ArticleEditorController
}

export function ArticleEditorMetadataPanel({ editor }: ArticleEditorMetadataPanelProps) {
  const { actions } = editor

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-2 pb-3 mb-1 border-b border-[var(--border)]">
        <Clock size={11} className="text-[var(--fg-faint)] shrink-0" />
        <span className="text-[12px] text-[var(--fg-faint)] uppercase tracking-wider font-medium">
          {editor.content.length > 2 ? readTimeLabel(editor.content) : '- min read'}
        </span>
        {editor.content.length > 2 && (
          <>
            <span className="text-[var(--fg-faint)]">·</span>
            <span className="text-[12px] text-[var(--fg-faint)] uppercase tracking-wider font-medium">
              {wordCountFromContent(editor.content).toLocaleString()} words
            </span>
          </>
        )}
      </div>

      {!editor.isWriter ? (
        <SelectField label="Status" value={editor.status} onChange={actions.setStatus}>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_REVIEW">Pending Review</option>
          {editor.canPublish && <option value="PUBLISHED">Published</option>}
          {editor.canPublish && <option value="SCHEDULED">Scheduled</option>}
          <option value="ARCHIVED">Archived</option>
        </SelectField>
      ) : (
        <div>
          <FieldLabel>Status</FieldLabel>
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-1 border rounded ${STATUS_COLOURS[editor.currentStatus] ?? STATUS_COLOURS.DRAFT}`}>
            {STATUS_LABELS[editor.currentStatus] ?? editor.currentStatus}
          </span>
        </div>
      )}

      {!editor.isWriter && editor.users.length > 0 && (
        <SelectField
          label="Author"
          value={editor.selectedAuthorId}
          onChange={actions.setSelectedAuthorId}
          disabled={!editor.canEdit}
        >
          {editor.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name ?? user.id}
              {user.role !== 'WRITER' ? ` (${user.role.charAt(0) + user.role.slice(1).toLowerCase()})` : ''}
            </option>
          ))}
        </SelectField>
      )}

      {!editor.isWriter && editor.status === 'SCHEDULED' && (
        <div>
          <FieldLabel>Publish At ({EDITORIAL_TIME_ZONE_LABEL})</FieldLabel>
          <input
            type="datetime-local"
            value={editor.scheduledAt}
            min={getEditorialScheduleMinInput()}
            onChange={(event) => actions.setScheduledAt(event.target.value)}
            className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold cursor-pointer"
          />
          <p className="text-[10px] text-[var(--fg-faint)] mt-1">Stored and displayed as UK editorial time.</p>
          {!editor.scheduledAt && <p className="text-amber-500 text-[10px] mt-1">Pick a future date and time.</p>}
        </div>
      )}

      <div>
        <FieldLabel>Category</FieldLabel>
        <div className="relative">
          <select
            value={editor.categoryId}
            onChange={(event) => actions.setCategoryId(event.target.value)}
            disabled={!editor.canEdit}
            className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 pr-6 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold appearance-none cursor-pointer disabled:opacity-60"
          >
            <option value="">No category</option>
            {editor.categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
        </div>
      </div>

      <div>
        <FieldLabel>Cover Image</FieldLabel>
        <input ref={editor.refs.coverFileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void actions.handleCoverUpload(event)} />
        <input
          type="url"
          value={editor.coverImage}
          onChange={(event) => actions.setCoverImage(event.target.value)}
          placeholder="https://..."
          className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold placeholder:text-[var(--fg-faint)]"
        />
        {editor.uploading && <p className="text-[10px] text-[var(--fg-faint)] mt-1">Uploading...</p>}
        {editor.coverError && <p className="text-[10px] text-red-500 mt-1">{editor.coverError}</p>}
        {editor.coverImage && (
          <div className="mt-2 relative h-20">
            <Image
              src={editor.coverImage}
              alt="Cover preview"
              fill
              className="object-contain rounded border border-[var(--border)] bg-[var(--bg-subtle)]"
              unoptimized
              sizes="280px"
            />
            {editor.canEdit && (
              <button
                type="button"
                onClick={actions.removeCoverImage}
                className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                aria-label="Remove cover image"
              >
                <X size={10} />
              </button>
            )}
          </div>
        )}
        {editor.canEdit && (
          <button
            type="button"
            onClick={actions.openCoverPicker}
            disabled={editor.uploading}
            className="mt-2 w-full h-7 text-[11px] border border-dashed border-[var(--border)] rounded text-[var(--fg-faint)] hover:border-gold hover:text-[var(--fg-muted)] transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <ImagePlus size={11} />
            {editor.uploading ? 'Uploading...' : 'Upload file'}
          </button>
        )}
        <p className="text-xs text-[var(--fg-faint)] mt-1.5 leading-snug">
          For best results: landscape orientation, minimum 1200 px wide, subject centred in frame.
        </p>
      </div>

      <div>
        <FieldLabel>
          <Tag size={9} />
          Tags
        </FieldLabel>
        {editor.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5 mt-1">
            {editor.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-[var(--bg-subtle)] rounded text-[var(--fg-muted)]">
                {tag}
                {editor.canEdit && (
                  <button
                    type="button"
                    onClick={() => actions.removeTag(tag)}
                    aria-label={`Remove ${tag}`}
                    className="hover:text-red-500 transition-colors ml-0.5"
                  >
                    <X size={7} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {editor.canEdit && (
          <input
            type="text"
            value={editor.tagInput}
            onChange={(event) => actions.setTagInput(event.target.value)}
            onKeyDown={actions.handleTagKeyDown}
            onBlur={() => editor.tagInput && actions.addTag(editor.tagInput)}
            placeholder={editor.tags.length < 10 ? 'Add a tag, press Enter...' : 'Max 10 tags'}
            disabled={editor.tags.length >= 10}
            className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold placeholder:text-[var(--fg-faint)] disabled:opacity-50"
          />
        )}
        <p className="text-[10px] text-[var(--fg-faint)] mt-1">Separate with Enter or comma. Up to 10.</p>
      </div>

      {!editor.isWriter && (
        <div>
          <FieldLabel>URL Slug</FieldLabel>
          <input
            type="text"
            value={editor.slug}
            onChange={(event) => actions.setSlug(event.target.value)}
            placeholder="url-slug"
            className="w-full h-8 text-[16px] sm:text-[11px] font-mono border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold"
          />
        </div>
      )}
    </div>
  )
}

interface SelectFieldProps {
  children?: React.ReactNode
  disabled?: boolean
  hidden?: boolean
  label: string
  onChange: (value: string) => void
  value?: string
}

function SelectField({ children, disabled, hidden, label, onChange, value }: SelectFieldProps) {
  if (hidden) return null

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 pr-6 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold appearance-none cursor-pointer disabled:opacity-60"
        >
          {children}
        </select>
        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)] mb-1 mt-3 flex items-center gap-1">
      {children}
    </label>
  )
}
