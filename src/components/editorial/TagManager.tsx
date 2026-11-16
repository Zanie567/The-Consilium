'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, ChevronDown, ExternalLink, GitMerge, Plus, Search, Undo2, X } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { foldTagText, findTagOverlaps, findExactTag, similarTags, OVERLAP_LABELS, type TagOption } from '@/lib/tags/taxonomy'
import type { ManagedTag, PendingSuggestion } from '@/lib/tags/manage'
import './tag-manager.css'

type Filter = 'active' | 'retired' | 'merged' | 'all'
type Sort = 'name' | 'most' | 'least' | 'newest'

type Dialog =
  | { kind: 'rename'; tag: ManagedTag }
  | { kind: 'describe'; tag: ManagedTag }
  | { kind: 'merge'; tag: ManagedTag; into?: string }
  | { kind: 'retire'; tag: ManagedTag }
  | { kind: 'approve'; suggestion: PendingSuggestion }
  | { kind: 'alias-suggestion'; suggestion: PendingSuggestion }
  | { kind: 'reject'; suggestion: PendingSuggestion }

const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function toOption(tag: ManagedTag): TagOption {
  return { id: tag.id, name: tag.name, slug: tag.slug, aliases: tag.aliases.map((a) => a.name), articleCount: tag.articleCount, retired: tag.retiredAt !== null }
}

export function TagManager({ tags, suggestions }: { tags: ManagedTag[]; suggestions: PendingSuggestion[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('active')
  const [sort, setSort] = useState<Sort>('name')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const live = useMemo(() => tags.filter((t) => !t.mergedInto), [tags])
  const options = useMemo(() => live.map(toOption), [live])
  const active = useMemo(() => live.filter((t) => !t.retiredAt), [live])
  const overlaps = useMemo(() => findTagOverlaps(active.map((t) => ({ ...t, aliases: t.aliases.map((a) => a.name) }))), [active])
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])

  const counts = {
    active: active.length,
    retired: live.length - active.length,
    merged: tags.length - live.length,
    all: tags.length,
  }

  const shown = useMemo(() => {
    const q = foldTagText(query)
    const rows = tags.filter((t) => {
      if (filter === 'active' && (t.retiredAt || t.mergedInto)) return false
      if (filter === 'retired' && (!t.retiredAt || t.mergedInto)) return false
      if (filter === 'merged' && !t.mergedInto) return false
      if (!q) return true
      return [t.name, t.slug, ...t.aliases.map((a) => a.name)].some((v) => foldTagText(v).includes(q))
    })
    const byName = (a: ManagedTag, b: ManagedTag) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' })
    return rows.sort((a, b) =>
      sort === 'most' ? b.articleCount - a.articleCount || byName(a, b)
        : sort === 'least' ? a.articleCount - b.articleCount || byName(a, b)
          : sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) || byName(a, b)
            : byName(a, b),
    )
  }, [tags, query, filter, sort])

  /** Runs a change, reports it, and re-reads the page's data from the server. */
  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setStatus(null)
    try {
      const text = await work()
      setStatus({ tone: 'ok', text })
      setDialog(null)
      router.refresh()
      return true
    } catch (reason) {
      setStatus({ tone: 'error', text: asApiError(reason).message })
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <header className="mb-6 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>Tags</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--fg-muted)]">
          The approved topics writers choose from. Renaming keeps a tag’s address, merging redirects the old one, and nothing here deletes an article’s tags.
        </p>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          <strong className="text-[var(--fg)]">{counts.active}</strong> active
          {counts.retired > 0 && <> · {counts.retired} retired</>}
          {counts.merged > 0 && <> · {counts.merged} merged</>}
          {suggestions.length > 0 && <> · <strong className="text-[var(--fg)]">{suggestions.length}</strong> {suggestions.length === 1 ? 'suggestion' : 'suggestions'} to review</>}
        </p>
      </header>

      <p role="status" aria-live="polite" className={`tag-status ${status ? '' : 'sr-only'} ${status?.tone === 'error' ? 'tag-status-error' : ''}`}>
        {status?.text ?? ''}
      </p>

      <CreateTag options={options} busy={busy} onCreate={(name) => run(async () => {
        const { tag } = await apiRequest<{ tag: { name: string } }>('/api/editorial/tags', { method: 'POST', ...json({ name }) })
        return `Created “${tag.name}”.`
      })} />

      {suggestions.length > 0 && (
        <section aria-labelledby="tag-suggestions" className="tag-panel">
          <h2 id="tag-suggestions" className="tag-panel-title">Suggested by writers</h2>
          <ul className="divide-y divide-[var(--border)]">
            {suggestions.map((s) => {
              const similar = similarTags(options, s.name, 2)
              return (
                <li key={s.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[var(--fg)]">{s.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                      {s.suggestedBy.name ?? 'A writer'}
                      {s.article && <> for <Link className="underline decoration-gold/50 underline-offset-2 hover:decoration-gold" href={`/editorial/articles/${s.article.id}/edit`}>{s.article.title || '(Untitled)'}</Link></>}
                    </p>
                    {s.note && <p className="mt-1 text-xs italic text-[var(--fg-muted)]">“{s.note}”</p>}
                    {similar.length > 0 && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Similar to {similar.map(({ tag }) => `“${tag.name}”`).join(' and ')}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="tag-btn tag-btn-primary" disabled={busy} onClick={() => setDialog({ kind: 'approve', suggestion: s })}>Approve…</button>
                    <button type="button" className="tag-btn" disabled={busy} onClick={() => setDialog({ kind: 'alias-suggestion', suggestion: s })}>Use existing tag…</button>
                    <button type="button" className="tag-btn" disabled={busy} onClick={() => setDialog({ kind: 'reject', suggestion: s })}>Decline</button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {overlaps.length > 0 && (
        <details className="tag-panel tag-overlaps" open={overlaps.some((o) => o.strength === 'likely')}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="tag-panel-title !mb-0">
              Possible duplicates <span className="font-normal text-[var(--fg-muted)]">({overlaps.length})</span>
            </span>
            <ChevronDown size={15} aria-hidden className="tag-chevron text-[var(--fg-faint)]" />
          </summary>
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            Found by wording alone. Nothing is merged automatically: check that two tags really mean the same topic before merging.
          </p>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {overlaps.map(({ a, b, reason, strength }) => (
              <li key={`${a.id}-${b.id}`} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold text-[var(--fg)]">{a.name}</span> <span className="text-xs text-[var(--fg-faint)]">({a.articleCount})</span>
                  <span className="mx-2 text-[var(--fg-faint)]">and</span>
                  <span className="font-semibold text-[var(--fg)]">{b.name}</span> <span className="text-xs text-[var(--fg-faint)]">({b.articleCount})</span>
                  <span className={`ml-2 tag-pill ${strength === 'likely' ? 'tag-pill-likely' : ''}`}>{OVERLAP_LABELS[reason]}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {/* Default direction: fold the less used tag into the more used one. */}
                  {[a.articleCount >= b.articleCount ? [b, a] : [a, b]].map(([from, to]) => (
                    <button key="merge" type="button" className="tag-btn" disabled={busy} onClick={() => setDialog({ kind: 'merge', tag: byId.get(from.id)!, into: to.id })}>
                      <GitMerge size={12} aria-hidden /> Merge “{from.name}” into “{to.name}”…
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="tag-list" className="mt-8">
        <h2 id="tag-list" className="sr-only">All tags</h2>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tags and aliases"
              placeholder="Search tags and aliases"
              className="tag-field w-full pl-10"
            />
          </div>
          <div className="relative sm:w-48">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort tags" className="tag-field w-full appearance-none pr-8">
              <option value="name">Name A to Z</option>
              <option value="most">Most used</option>
              <option value="least">Least used</option>
              <option value="newest">Newest</option>
            </select>
            <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]" />
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Show">
          {(['active', 'retired', 'merged', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`tag-tab ${filter === f ? 'tag-tab-on' : ''}`}>
              {{ active: 'Active', retired: 'Retired', merged: 'Merged', all: 'All' }[f]} <span className="opacity-60">{counts[f]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="border border-[var(--border)] bg-[var(--bg-elevated)] px-6 py-12 text-center text-sm text-[var(--fg-muted)]">
            {tags.length === 0 ? 'No tags yet. Create the first one above.' : 'No tags match.'}
          </div>
        ) : (
          <ul className="tag-list" aria-label="Tags">
            {shown.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                busy={busy}
                onDialog={setDialog}
                onAddAlias={(name) => run(async () => {
                  await apiRequest(`/api/editorial/tags/${tag.id}/aliases`, { method: 'POST', ...json({ name }) })
                  return `“${name}” now finds “${tag.name}”.`
                })}
                onRemoveAlias={(alias) => run(async () => {
                  await apiRequest(`/api/editorial/tags/${tag.id}/aliases/${alias.id}`, { method: 'DELETE' })
                  return `“${alias.name}” no longer finds “${tag.name}”.`
                })}
                onRestore={() => run(async () => {
                  await apiRequest(`/api/editorial/tags/${tag.id}`, { method: 'PATCH', ...json({ retired: false }) })
                  return `“${tag.name}” is active again.`
                })}
                onUndoMerge={() => run(async () => {
                  const { restored } = await apiRequest<{ restored: number }>(`/api/editorial/tags/${tag.id}/merge`, { method: 'DELETE' })
                  return `Merge undone: “${tag.name}” is back on ${restored} ${restored === 1 ? 'article' : 'articles'}.`
                })}
              />
            ))}
          </ul>
        )}
      </section>

      {dialog && (
        <TagDialog dialog={dialog} options={options} busy={busy} onClose={() => !busy && setDialog(null)} run={run} />
      )}
    </div>
  )
}

function CreateTag({ options, busy, onCreate }: { options: TagOption[]; busy: boolean; onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const exact = name.trim() ? findExactTag(options, name) : null
  const similar = name.trim() && !exact ? similarTags(options, name, 3) : []
  return (
    <form
      className="tag-panel"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim() || exact) return
        if (await onCreate(name)) setName('')
      }}
    >
      <label htmlFor="new-tag" className="tag-panel-title block">Create a tag</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="new-tag" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Monetary Policy" className="tag-field flex-1" maxLength={80} autoComplete="off" aria-describedby="new-tag-hint" />
        <button type="submit" className="tag-btn tag-btn-primary h-10 justify-center px-5" disabled={busy || !name.trim() || Boolean(exact)}>
          <Plus size={13} aria-hidden /> Create tag
        </button>
      </div>
      <p id="new-tag-hint" className="mt-1.5 text-xs text-[var(--fg-muted)]" aria-live="polite">
        {exact
          ? exact.via ? `“${exact.via}” is already another name for “${exact.tag.name}”.` : `“${exact.tag.name}” already exists${exact.tag.retired ? ' (retired: restore it below)' : ''}.`
          : similar.length > 0
            ? `Check first: ${similar.map(({ tag, reason }) => `“${tag.name}” (${OVERLAP_LABELS[reason].toLowerCase()})`).join(', ')}.`
            : 'Use the wording readers would search for, in title case. Add other wordings as aliases.'}
      </p>
    </form>
  )
}

function TagRow({ tag, busy, onDialog, onAddAlias, onRemoveAlias, onRestore, onUndoMerge }: {
  tag: ManagedTag
  busy: boolean
  onDialog: (d: Dialog) => void
  onAddAlias: (name: string) => Promise<boolean>
  onRemoveAlias: (alias: { id: string; name: string }) => Promise<boolean>
  onRestore: () => void
  onUndoMerge: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [alias, setAlias] = useState('')
  const aliasRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (adding) aliasRef.current?.focus() }, [adding])
  const state = tag.mergedInto ? 'merged' : tag.retiredAt ? 'retired' : 'active'

  return (
    <li className={`tag-row tag-row-${state}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-[0.95rem] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{tag.name}</h3>
          {state !== 'active' && <span className="tag-pill">{state === 'merged' ? 'Merged' : 'Retired'}</span>}
          <a href={`/tag/${tag.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-muted)] hover:text-gold">
            /tag/{tag.slug} <ExternalLink size={10} aria-hidden /><span className="sr-only">(opens the public page)</span>
          </a>
        </div>
        {tag.mergedInto && (
          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--fg-muted)]">
            <ArrowRight size={11} aria-hidden /> Articles and its address now go to <strong className="text-[var(--fg)]">{tag.mergedInto.name}</strong>
          </p>
        )}
        {tag.description && <p className="mt-1 text-xs text-[var(--fg-muted)]">{tag.description}</p>}
        {!tag.mergedInto && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tag.aliases.length > 0 && <span className="text-[11px] text-[var(--fg-faint)]">Also found by</span>}
            {tag.aliases.map((a) => (
              <span key={a.id} className="tag-alias">
                {a.name}
                <button type="button" aria-label={`Remove alias ${a.name} from ${tag.name}`} disabled={busy} onClick={() => onRemoveAlias(a)}>
                  <X size={10} aria-hidden />
                </button>
              </span>
            ))}
            {adding ? (
              <form
                className="inline-flex items-center gap-1"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!alias.trim()) return
                  if (await onAddAlias(alias)) { setAlias(''); setAdding(false) }
                }}
              >
                <input ref={aliasRef} value={alias} onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false) }} aria-label={`New alias for ${tag.name}`} placeholder="Another wording" className="tag-field h-7 w-40 text-xs" maxLength={80} />
                <button type="submit" className="tag-btn h-7" disabled={busy || !alias.trim()}>Add</button>
                <button type="button" className="tag-btn h-7" onClick={() => setAdding(false)}>Cancel</button>
              </form>
            ) : (
              <button type="button" className="tag-link" onClick={() => setAdding(true)} aria-label={`Add an alias to ${tag.name}`}>
                <Plus size={11} aria-hidden /> Alias
              </button>
            )}
          </div>
        )}
      </div>
      <p className="tag-count">
        <span className="font-semibold tabular-nums text-[var(--fg)]">{tag.articleCount}</span>{' '}
        <span className="text-[var(--fg-muted)]">{tag.articleCount === 1 ? 'article' : 'articles'}</span>
        {tag.articleCount > 0 && <span className="block text-[11px] text-[var(--fg-faint)]">{tag.publishedCount} published</span>}
      </p>
      <div className="tag-actions">
        {state === 'merged' ? (
          <button type="button" className="tag-btn tag-btn-ghost" disabled={busy} onClick={onUndoMerge}><Undo2 size={12} aria-hidden /> Undo merge</button>
        ) : (
          <>
            <button type="button" className="tag-btn tag-btn-ghost" disabled={busy} onClick={() => onDialog({ kind: 'rename', tag })} aria-label={`Rename ${tag.name}`}>Rename</button>
            <button type="button" className="tag-btn tag-btn-ghost" disabled={busy} onClick={() => onDialog({ kind: 'describe', tag })} aria-label={`Describe ${tag.name}`}>Describe</button>
            {state === 'active' && (
              <button type="button" className="tag-btn tag-btn-ghost" disabled={busy} onClick={() => onDialog({ kind: 'merge', tag })} aria-label={`Merge ${tag.name} into another tag`}>
                <GitMerge size={12} aria-hidden /> Merge
              </button>
            )}
            {state === 'active'
              ? <button type="button" className="tag-btn tag-btn-ghost" disabled={busy} onClick={() => onDialog({ kind: 'retire', tag })} aria-label={`Retire ${tag.name}`}>Retire</button>
              : <button type="button" className="tag-btn tag-btn-ghost" disabled={busy} onClick={onRestore} aria-label={`Restore ${tag.name}`}>Restore</button>}
          </>
        )}
      </div>
    </li>
  )
}

/** One dialog for every action that needs a choice or a confirmation. */
function TagDialog({ dialog, options, busy, onClose, run }: {
  dialog: Dialog
  options: TagOption[]
  busy: boolean
  onClose: () => void
  run: (work: () => Promise<string>) => Promise<boolean>
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const initialText = dialog.kind === 'rename' ? dialog.tag.name : dialog.kind === 'describe' ? dialog.tag.description ?? '' : dialog.kind === 'approve' ? dialog.suggestion.name : ''
  const [text, setText] = useState(initialText)
  const [target, setTarget] = useState(dialog.kind === 'merge' ? dialog.into ?? '' : '')
  const [targetQuery, setTargetQuery] = useState('')
  const [preview, setPreview] = useState<{ moving: number; alreadyOnTarget: number } | null>(null)

  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button')
    first?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const sourceId = dialog.kind === 'merge' ? dialog.tag.id : null
  useEffect(() => {
    setPreview(null)
    if (!sourceId || !target) return
    let cancelled = false
    apiRequest<{ moving: number; alreadyOnTarget: number }>(`/api/editorial/tags/${sourceId}/merge?into=${encodeURIComponent(target)}`)
      .then((p) => { if (!cancelled) setPreview(p) }, () => {})
    return () => { cancelled = true }
  }, [sourceId, target])

  const choosable = options.filter((o) => !o.retired && o.id !== sourceId && (!targetQuery || foldTagText(o.name).includes(foldTagText(targetQuery)) || o.aliases.some((a) => foldTagText(a).includes(foldTagText(targetQuery)))))
  const targetTag = options.find((o) => o.id === target)

  let title = ''
  let body: ReactNode = null
  let confirm = ''
  let action: (() => Promise<string>) | null = null
  let danger = false

  switch (dialog.kind) {
    case 'rename':
      title = `Rename “${dialog.tag.name}”`
      confirm = 'Rename'
      body = (
        <>
          <label className="tag-dialog-label" htmlFor={`${titleId}-name`}>New name</label>
          <input id={`${titleId}-name`} value={text} onChange={(e) => setText(e.target.value)} className="tag-field w-full" maxLength={80} />
          <p className="tag-dialog-note">The address stays /tag/{dialog.tag.slug}. The old name becomes an alias, so writers typing it still find this tag.</p>
        </>
      )
      action = text.trim() && text.trim() !== dialog.tag.name ? async () => {
        const { tag } = await apiRequest<{ tag: { name: string } }>(`/api/editorial/tags/${dialog.tag.id}`, { method: 'PATCH', ...json({ name: text }) })
        return `Renamed to “${tag.name}”.`
      } : null
      break
    case 'describe':
      title = `Describe “${dialog.tag.name}”`
      confirm = 'Save'
      body = (
        <>
          <label className="tag-dialog-label" htmlFor={`${titleId}-desc`}>What belongs under this tag (for writers; not shown to readers)</label>
          <textarea id={`${titleId}-desc`} value={text} onChange={(e) => setText(e.target.value)} className="tag-field h-24 w-full py-2" maxLength={500} />
        </>
      )
      action = async () => {
        await apiRequest(`/api/editorial/tags/${dialog.tag.id}`, { method: 'PATCH', ...json({ description: text }) })
        return `Saved the description of “${dialog.tag.name}”.`
      }
      break
    case 'merge':
      title = `Merge “${dialog.tag.name}” into another tag`
      confirm = 'Merge'
      danger = true
      body = (
        <>
          <label className="tag-dialog-label" htmlFor={`${titleId}-find`}>Merge into</label>
          <input id={`${titleId}-find`} value={targetQuery} onChange={(e) => setTargetQuery(e.target.value)} placeholder="Search tags" className="tag-field mb-2 w-full" />
          <select aria-label="Tag to merge into" size={6} value={target} onChange={(e) => setTarget(e.target.value)} className="tag-field h-auto w-full py-1">
            {choosable.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.articleCount})</option>)}
          </select>
          {targetTag && (
            <div className="tag-dialog-note">
              <p>
                {preview ? <><strong>{preview.moving}</strong> {preview.moving === 1 ? 'article moves' : 'articles move'} from “{dialog.tag.name}” to “{targetTag.name}”{preview.alreadyOnTarget > 0 && <> ({preview.alreadyOnTarget} already {preview.alreadyOnTarget === 1 ? 'has' : 'have'} both)</>}.</> : 'Counting articles…'}
              </p>
              <p className="mt-1">/tag/{dialog.tag.slug} will redirect to /tag/{targetTag.slug}, and “{dialog.tag.name}” will find “{targetTag.name}” in the editor. You can undo this from the Merged list.</p>
            </div>
          )}
        </>
      )
      action = target ? async () => {
        const result = await apiRequest<{ moved: number; target: { name: string } }>(`/api/editorial/tags/${dialog.tag.id}/merge`, { method: 'POST', ...json({ into: target }) })
        return `Merged “${dialog.tag.name}” into “${result.target.name}” (${result.moved} ${result.moved === 1 ? 'article' : 'articles'} moved).`
      } : null
      break
    case 'retire':
      title = `Retire “${dialog.tag.name}”?`
      confirm = 'Retire'
      danger = true
      body = (
        <p className="tag-dialog-note">
          Writers will no longer be able to add it. The {dialog.tag.articleCount} {dialog.tag.articleCount === 1 ? 'article' : 'articles'} carrying it keep it, and /tag/{dialog.tag.slug} keeps working. If it duplicates another tag, merge it instead. You can restore it at any time.
        </p>
      )
      action = async () => {
        await apiRequest(`/api/editorial/tags/${dialog.tag.id}`, { method: 'PATCH', ...json({ retired: true }) })
        return `Retired “${dialog.tag.name}”.`
      }
      break
    case 'approve': {
      const similar = similarTags(options, text || dialog.suggestion.name, 3)
      title = `Approve “${dialog.suggestion.name}”`
      confirm = 'Create tag'
      body = (
        <>
          <label className="tag-dialog-label" htmlFor={`${titleId}-approve`}>Tag name (correct the wording if needed)</label>
          <input id={`${titleId}-approve`} value={text} onChange={(e) => setText(e.target.value)} className="tag-field w-full" maxLength={80} />
          {similar.length > 0 && <p className="tag-dialog-note text-amber-700 dark:text-amber-400">Similar existing tags: {similar.map(({ tag }) => `“${tag.name}”`).join(', ')}. Consider “Use existing tag” instead.</p>}
          <p className="tag-dialog-note">{dialog.suggestion.suggestedBy.name ?? 'The writer'} will be notified and can then choose it.</p>
        </>
      )
      action = text.trim() ? async () => {
        await apiRequest(`/api/editorial/tags/suggestions/${dialog.suggestion.id}`, { method: 'PATCH', ...json({ action: 'approve', name: text }) })
        return `Approved: “${text.trim()}” is now a tag.`
      } : null
      break
    }
    case 'alias-suggestion':
      title = `Use an existing tag for “${dialog.suggestion.name}”`
      confirm = 'Add as alias'
      body = (
        <>
          <label className="tag-dialog-label" htmlFor={`${titleId}-find`}>Existing tag</label>
          <input id={`${titleId}-find`} value={targetQuery} onChange={(e) => setTargetQuery(e.target.value)} placeholder="Search tags" className="tag-field mb-2 w-full" />
          <select aria-label="Existing tag" size={6} value={target} onChange={(e) => setTarget(e.target.value)} className="tag-field h-auto w-full py-1">
            {choosable.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.articleCount})</option>)}
          </select>
          <p className="tag-dialog-note">“{dialog.suggestion.name}” becomes another name for the chosen tag, so the next writer who types it finds that tag.</p>
        </>
      )
      action = target ? async () => {
        await apiRequest(`/api/editorial/tags/suggestions/${dialog.suggestion.id}`, { method: 'PATCH', ...json({ action: 'alias', tagId: target }) })
        return `“${dialog.suggestion.name}” now finds “${targetTag?.name}”.`
      } : null
      break
    case 'reject':
      title = `Decline “${dialog.suggestion.name}”`
      confirm = 'Decline'
      danger = true
      body = (
        <>
          <label className="tag-dialog-label" htmlFor={`${titleId}-reason`}>Reason (sent to {dialog.suggestion.suggestedBy.name ?? 'the writer'}, optional)</label>
          <textarea id={`${titleId}-reason`} value={text} onChange={(e) => setText(e.target.value)} className="tag-field h-20 w-full py-2" maxLength={300} />
        </>
      )
      action = async () => {
        await apiRequest(`/api/editorial/tags/suggestions/${dialog.suggestion.id}`, { method: 'PATCH', ...json({ action: 'reject', reason: text }) })
        return `Declined “${dialog.suggestion.name}”.`
      }
      break
  }

  return (
    <div className="tag-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="tag-dialog">
        <h2 id={titleId} className="text-lg font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{title}</h2>
        <form
          className="mt-4"
          onSubmit={(e) => { e.preventDefault(); if (action && !busy) void run(action) }}
        >
          {body}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="tag-btn h-10 px-4" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={`tag-btn h-10 px-4 ${danger ? 'tag-btn-danger' : 'tag-btn-primary'}`} disabled={busy || !action}>
              {busy ? 'Saving…' : confirm}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
