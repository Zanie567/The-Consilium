'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlusCircle, Pencil, Trash2, Search } from 'lucide-react'

/**
 * Admin CRUD for glossary terms plus the site-wide linking switch.
 * All mutations go through /api/editorial/glossary*, which re-verifies the
 * ADMIN role against the database and validates every field server-side; the
 * client-side constraints here exist only for friendlier feedback.
 */

export interface GlossaryTermRow {
  id: string
  term: string
  aliases: string[]
  definition: string
  learnMoreUrl: string | null
  isActive: boolean
  updatedAt: string
}

interface FormValues {
  term: string
  aliases: string
  definition: string
  learnMoreUrl: string
}

const EMPTY_FORM: FormValues = { term: '', aliases: '', definition: '', learnMoreUrl: '' }

const inputClass =
  'w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-gold focus:outline-none'
const labelClass = 'block text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-1.5'

function formFor(term: GlossaryTermRow): FormValues {
  return {
    term: term.term,
    aliases: term.aliases.join(', '),
    definition: term.definition,
    learnMoreUrl: term.learnMoreUrl ?? '',
  }
}

export function GlossaryManager({
  initialTerms,
  initialEnabled,
}: {
  initialTerms: GlossaryTermRow[]
  initialEnabled: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [enabled, setEnabled] = useState(initialEnabled)
  const [togglePending, setTogglePending] = useState(false)
  // 'new' opens the create form; a term id opens the edit form for that row.
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormValues>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return initialTerms
    return initialTerms.filter(
      (t) =>
        t.term.toLowerCase().includes(q) ||
        t.aliases.some((a) => a.toLowerCase().includes(q)) ||
        t.definition.toLowerCase().includes(q)
    )
  }, [initialTerms, search])

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function openCreate() {
    setEditing('new')
    setForm(EMPTY_FORM)
    setError(null)
  }

  function openEdit(term: GlossaryTermRow) {
    setEditing(term.id)
    setForm(formFor(term))
    setError(null)
  }

  function closeForm() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function toggleEnabled() {
    setTogglePending(true)
    setError(null)
    const next = !enabled
    try {
      const res = await fetch('/api/editorial/glossary/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Updating the switch failed.')
        return
      }
      setEnabled(next)
      router.refresh()
    } catch {
      setError('Updating the switch failed. Please try again.')
    } finally {
      setTogglePending(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    setError(null)
    const existing = editing !== 'new' ? initialTerms.find((t) => t.id === editing) : null
    try {
      const payload = {
        term: form.term,
        aliases: form.aliases
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
        definition: form.definition,
        learnMoreUrl: form.learnMoreUrl.trim() === '' ? null : form.learnMoreUrl.trim(),
        isActive: existing ? existing.isActive : true,
      }
      const res = await fetch(
        editing === 'new' ? '/api/editorial/glossary' : `/api/editorial/glossary/${editing}`,
        {
          method: editing === 'new' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Saving failed. Please try again.')
        return
      }
      closeForm()
      router.refresh()
    } catch {
      setError('Saving failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function setActive(term: GlossaryTermRow, isActive: boolean) {
    setBusyId(term.id)
    setError(null)
    try {
      const res = await fetch(`/api/editorial/glossary/${term.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: term.term,
          aliases: term.aliases,
          definition: term.definition,
          learnMoreUrl: term.learnMoreUrl,
          isActive,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Updating the term failed.')
        return
      }
      router.refresh()
    } catch {
      setError('Updating the term failed. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(term: GlossaryTermRow) {
    if (
      !window.confirm(
        `Delete "${term.term}" permanently? If it might come back, deactivate it instead.`
      )
    ) {
      return
    }
    setBusyId(term.id)
    setError(null)
    try {
      const res = await fetch(`/api/editorial/glossary/${term.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Deleting the term failed.')
        return
      }
      if (editing === term.id) closeForm()
      router.refresh()
    } catch {
      setError('Deleting the term failed. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const activeCount = initialTerms.filter((t) => t.isActive).length

  return (
    <div className="space-y-6">
      {/* Site-wide switch */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--fg)]">Term linking on articles</p>
          <p className="text-xs text-[var(--fg-muted)] mt-1">
            {enabled
              ? `Live. The first mention of each active term (${activeCount} right now) gets a tooltip on published articles.`
              : 'Off. Articles render exactly as before. Seed your terms, then flip this on when you are ready.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Term linking on articles"
          disabled={togglePending}
          onClick={toggleEnabled}
          className={[
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
            enabled ? 'bg-gold' : 'bg-[var(--border)]',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-6' : 'translate-x-1',
            ].join(' ')}
          />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search terms, aliases, definitions"
            aria-label="Search glossary terms"
            className={`${inputClass} pl-9`}
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 bg-navy text-cream text-xs font-bold uppercase tracking-widest px-3 sm:px-5 py-2.5 hover:bg-navy/90 transition-colors min-h-[44px]"
        >
          <PlusCircle size={14} />
          <span className="hidden sm:inline">New term</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Create / edit form */}
      {editing !== null && (
        <form
          onSubmit={submit}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:p-5 space-y-4"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-gold">
            {editing === 'new' ? 'New term' : 'Edit term'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="gl-term" className={labelClass}>Term</label>
              <input
                id="gl-term"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={form.term}
                onChange={(e) => set('term', e.target.value)}
                placeholder="quantitative easing"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="gl-aliases" className={labelClass}>Aliases (comma separated, optional)</label>
              <input
                id="gl-aliases"
                type="text"
                value={form.aliases}
                onChange={(e) => set('aliases', e.target.value)}
                placeholder="QE"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="gl-definition" className={labelClass}>Definition</label>
            <textarea
              id="gl-definition"
              rows={3}
              required
              minLength={10}
              maxLength={600}
              value={form.definition}
              onChange={(e) => set('definition', e.target.value)}
              placeholder="One to three plain sentences. Write for a first-year reader meeting the term for the first time."
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="gl-url" className={labelClass}>Learn more URL (optional)</label>
            <input
              id="gl-url"
              type="url"
              maxLength={300}
              value={form.learnMoreUrl}
              onChange={(e) => set('learnMoreUrl', e.target.value)}
              placeholder="https://www.bankofengland.co.uk/monetary-policy/quantitative-easing"
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="bg-navy text-cream text-xs font-bold uppercase tracking-widest px-5 py-2.5 hover:bg-navy/90 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {saving ? 'Saving...' : editing === 'new' ? 'Add term' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="text-xs uppercase tracking-widest text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Term list */}
      {initialTerms.length === 0 ? (
        <p className="text-sm text-[var(--fg-faint)] border border-dashed border-[var(--border)] rounded-lg p-8 text-center">
          No glossary terms yet. Add the concepts your readers ask about most, quantitative
          easing and the Phillips curve are good places to start.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--fg-faint)] border border-dashed border-[var(--border)] rounded-lg p-8 text-center">
          Nothing matches that search.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((term) => (
            <div
              key={term.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-[var(--fg)]">{term.term}</h2>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest ${
                        term.isActive
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]'
                      }`}
                    >
                      {term.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {term.aliases.length > 0 && (
                      <span className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                        also {term.aliases.join(', ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--fg-muted)] mt-1.5 max-w-2xl">{term.definition}</p>
                  {term.learnMoreUrl && (
                    <a
                      href={term.learnMoreUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-gold hover:underline mt-1 inline-block break-all"
                    >
                      {term.learnMoreUrl}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(term)}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-[var(--fg-muted)] hover:text-[var(--fg)] border border-[var(--border)] px-3 py-2 transition-colors"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId === term.id}
                    onClick={() => setActive(term, !term.isActive)}
                    className="text-[11px] uppercase tracking-widest text-[var(--fg-muted)] hover:text-[var(--fg)] border border-[var(--border)] px-3 py-2 transition-colors disabled:opacity-50"
                  >
                    {term.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === term.id}
                    onClick={() => remove(term)}
                    aria-label={`Delete ${term.term}`}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-red-500/80 hover:text-red-500 border border-[var(--border)] px-3 py-2 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
