'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Plus, Settings2, Tag as TagIcon, X } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { MAX_ARTICLE_TAGS, RECOMMENDED_ARTICLE_TAGS, canonicalTagSlug, topicDisplayName } from '@/lib/tagIdentity'
import { findExactTag, matchTags, similarTags, type TagOption } from '@/lib/tags/taxonomy'
import './tag-selector.css'

interface TagCatalogue {
  tags: TagOption[]
  canManage: boolean
}

// One request per editor page, shared by both copies of the panel (desktop sidebar and phone sheet).
let catalogue: Promise<TagCatalogue> | null = null
function loadCatalogue(force = false): Promise<TagCatalogue> {
  if (!catalogue || force) {
    catalogue = apiRequest<TagCatalogue>('/api/editorial/tags', { cache: 'no-store' }).catch((error) => {
      catalogue = null
      throw error
    })
  }
  return catalogue
}

type Row =
  | { kind: 'tag'; tag: TagOption; via?: string; similar?: boolean }
  | { kind: 'create'; name: string }
  | { kind: 'suggest'; name: string }

interface TagSelectorProps {
  /** The article's tags, by name (what the save request and local drafts carry). */
  tags: string[]
  onAdd: (name: string) => void
  onRemove: (name: string) => void
  disabled?: boolean
  articleId?: string | null
}

/**
 * The article editor's tag field: a searchable list of approved tags (found by name or alias), shown
 * as removable chips once chosen. Free text never becomes a tag by accident: a tag manager creates a
 * new tag explicitly, and everyone else suggests it for review. When the typed wording already exists,
 * or is close to an existing tag, that tag is offered first.
 *
 * Keyboard: type to search, Up/Down to move, Enter or comma to choose, Escape to close,
 * Backspace in an empty field removes the last tag. ARIA 1.2 combobox with a listbox popup.
 */
export function TagSelector({ tags, onAdd, onRemove, disabled = false, articleId }: TagSelectorProps) {
  const [data, setData] = useState<TagCatalogue | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const hintId = useId()

  const load = useCallback((force = false) => {
    setLoadError(false)
    loadCatalogue(force).then(setData, () => setLoadError(true))
  }, [])
  useEffect(() => { load() }, [load])

  const options = useMemo(() => data?.tags ?? [], [data])
  const selected = useMemo(() => new Set(tags.map(canonicalTagSlug)), [tags])
  const isSelected = useCallback(
    (tag: TagOption) => selected.has(canonicalTagSlug(tag.name)) || tag.aliases.some((a) => selected.has(canonicalTagSlug(a))),
    [selected],
  )
  const atLimit = tags.length >= MAX_ARTICLE_TAGS
  const cleaned = topicDisplayName(query)
  const exact = cleaned ? findExactTag(options, cleaned) : null

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const seen = new Set<string>()
    for (const match of matchTags(options, query, 8)) {
      if (isSelected(match.tag)) continue
      seen.add(match.tag.id)
      out.push({ kind: 'tag', tag: match.tag, via: match.via })
    }
    if (cleaned && !exact) {
      // Near matches go first, most used first, so the existing tag is the default choice.
      const near: Row[] = similarTags(options, cleaned)
        .filter(({ tag }) => !seen.has(tag.id) && !isSelected(tag))
        .map(({ tag }) => ({ kind: 'tag', tag, similar: true }))
      out.unshift(...near)
      if (data) out.push(data.canManage ? { kind: 'create', name: cleaned } : { kind: 'suggest', name: cleaned })
    }
    return out
  }, [options, query, cleaned, exact, data, isSelected])

  useEffect(() => { setActive(0) }, [query])

  const choose = (tag: TagOption, via?: string) => {
    if (atLimit) return
    onAdd(tag.name)
    setQuery('')
    setNotice(via ? { tone: 'ok', text: `“${via}” is another name for “${tag.name}”, which was added.` } : null)
    inputRef.current?.focus()
  }

  const createTag = async (name: string) => {
    setBusy(true)
    try {
      const { tag } = await apiRequest<{ tag: { id: string; name: string; slug: string } }>('/api/editorial/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      onAdd(tag.name)
      setQuery('')
      setNotice({ tone: 'ok', text: `Created the tag “${tag.name}”.` })
      setData(await loadCatalogue(true))
    } catch (reason) {
      const error = asApiError(reason)
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const suggestTag = async (name: string) => {
    setBusy(true)
    try {
      const result = await apiRequest<{ existing?: { name: string }; suggestion?: { name: string } }>('/api/editorial/tags/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, articleId: articleId ?? undefined }),
      })
      setQuery('')
      if (result.existing) {
        // Someone created it meanwhile: use it.
        if (!atLimit && !selected.has(canonicalTagSlug(result.existing.name))) onAdd(result.existing.name)
        setNotice({ tone: 'ok', text: `“${result.existing.name}” already exists and was added.` })
        setData(await loadCatalogue(true))
      } else {
        setNotice({ tone: 'ok', text: `Suggested “${name}”. A tag manager will review it and you will be notified; it is not on the article yet.` })
      }
    } catch (reason) {
      setNotice({ tone: 'error', text: asApiError(reason).message })
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const activate = (row: Row | undefined) => {
    if (!row || busy) return
    if (row.kind === 'tag') choose(row.tag, row.via)
    else if (row.kind === 'create') void createTag(row.name)
    else void suggestTag(row.name)
  }

  const commitTyped = () => {
    if (!cleaned) return
    if (exact) {
      if (exact.tag.retired) setNotice({ tone: 'warn', text: `“${exact.tag.name}” has been retired and can no longer be added.` })
      else if (isSelected(exact.tag)) { setQuery(''); setNotice({ tone: 'ok', text: `“${exact.tag.name}” is already on this article.` }) }
      else choose(exact.tag, exact.via)
      return
    }
    // The tag list could not be loaded: let the server decide (it refuses unapproved names).
    if (!data) { onAdd(cleaned); setQuery(''); return }
    activate(rows[active])
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
    } else if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (open && rows[active] && (rows[active].kind !== 'tag' || !exact)) activate(rows[active])
      else commitTyped()
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
    } else if (event.key === 'Backspace' && !query && tags.length > 0) {
      onRemove(tags[tags.length - 1])
    }
  }

  const tagFor = (name: string) => findExactTag(options, name)?.tag
  const tooMany = tags.length > RECOMMENDED_ARTICLE_TAGS.max
  const showList = open && !disabled && !atLimit && (rows.length > 0 || Boolean(cleaned) || loadError)
  const activeRow = showList ? rows[active] : undefined

  return (
    <div className="tag-selector">
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <label htmlFor={`${listId}-input`} className="flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-[var(--fg-faint)]">
          <TagIcon size={9} aria-hidden />
          Tags
        </label>
        {data?.canManage && (
          <Link href="/editorial/tags" prefetch={false} className="flex items-center gap-1 text-[10px] text-[var(--fg-muted)] hover:text-gold">
            <Settings2 size={10} aria-hidden />
            Manage tags
          </Link>
        )}
      </div>

      {tags.length > 0 && (
        <ul className="mb-1.5 mt-1 flex flex-wrap gap-1" aria-label="Chosen tags">
          {tags.map((name) => {
            const known = tagFor(name)
            return (
              <li key={name} className={`tag-chip ${known?.retired ? 'tag-chip-retired' : ''}`}>
                <span>{known?.name ?? name}</span>
                {known?.retired && <span className="text-[9px] uppercase tracking-wide opacity-70">retired</span>}
                {!disabled && (
                  <button type="button" onClick={() => onRemove(name)} aria-label={`Remove ${name}`} className="tag-chip-remove">
                    <X size={9} aria-hidden />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!disabled && (
        <div className="relative">
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="text"
            role="combobox"
            aria-label="Article topics"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeRow ? `${listId}-${active}` : undefined}
            aria-describedby={hintId}
            autoComplete="off"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            placeholder={atLimit ? `Max ${MAX_ARTICLE_TAGS} tags` : 'Add a tag, press Enter...'}
            disabled={atLimit || busy}
            className="w-full h-8 text-[16px] sm:text-[12px] border border-[var(--border)] rounded px-2 bg-[var(--bg-elevated)] focus:outline-none focus:border-gold placeholder:text-[var(--fg-faint)] disabled:opacity-50"
          />
          {showList && (
            <ul id={listId} role="listbox" aria-label="Matching tags" className="tag-selector-list">
              {loadError && (
                <li className="px-2.5 py-2 text-[11px] text-[var(--fg-muted)]" role="presentation">
                  Tags could not be loaded.{' '}
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => load(true)} className="font-semibold underline">Try again</button>
                </li>
              )}
              {rows.map((row, index) => (
                <li
                  key={row.kind === 'tag' ? row.tag.id : row.kind}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => activate(row)}
                  className="tag-selector-option"
                >
                  {row.kind === 'tag' ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[var(--fg)]">{row.tag.name}</span>
                        {(row.via || row.similar) && (
                          <span className="block truncate text-[10px] text-[var(--fg-muted)]">
                            {row.similar ? 'Similar existing tag' : `Also called “${row.via}”`}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-[var(--fg-faint)]">{row.tag.articleCount}</span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 font-medium text-[var(--fg)]">
                      <Plus size={11} aria-hidden />
                      {row.kind === 'create' ? `Create “${row.name}” as a new tag` : `Suggest “${row.name}” for review`}
                    </span>
                  )}
                </li>
              ))}
              {cleaned && exact && isSelected(exact.tag) && (
                <li role="presentation" className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-[var(--fg-muted)]">
                  <Check size={11} aria-hidden /> “{exact.tag.name}” is already on this article.
                </li>
              )}
              {cleaned && exact?.tag.retired && (
                <li role="presentation" className="px-2.5 py-2 text-[11px] text-[var(--fg-muted)]">“{exact.tag.name}” has been retired.</li>
              )}
            </ul>
          )}
        </div>
      )}

      <p id={hintId} className={`mt-1 text-[10px] ${tooMany ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--fg-faint)]'}`}>
        {tooMany
          ? `${tags.length} tags. ${RECOMMENDED_ARTICLE_TAGS.min}–${RECOMMENDED_ARTICLE_TAGS.max} precise tags keep topic pages useful.`
          : `Choose ${RECOMMENDED_ARTICLE_TAGS.min}–${RECOMMENDED_ARTICLE_TAGS.max} relevant tags (at most ${MAX_ARTICLE_TAGS}).`}
      </p>
      <p role="status" aria-live="polite" className={`text-[10px] ${notice?.tone === 'error' ? 'text-red-600 dark:text-red-400' : notice?.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--fg-muted)]'}`}>
        {notice?.text ?? ''}
      </p>
    </div>
  )
}
