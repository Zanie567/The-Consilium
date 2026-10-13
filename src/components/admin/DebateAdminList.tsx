'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DEBATE_VISIBILITY_LABEL } from '@/lib/debateVisibility'
import {
  filterDebateRows,
  sortDebateRows,
  type DebateAdminRow,
  type DebateStatusFilter,
} from '@/lib/debateAdmin'
import type { DebateAction } from '@/lib/debateLifecycle'

const STATUS_FILTERS: { value: DebateStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'unpublished', label: 'Unpublished' },
  { value: 'deleted', label: 'Deleted' },
]

const ACTION_COPY: Record<DebateAction, { title: string; confirm: string; tone: 'default' | 'danger'; done: string; message: (t: string) => string }> = {
  unpublish: {
    title: 'Unpublish this debate?',
    confirm: 'Unpublish',
    tone: 'danger',
    done: 'Unpublished. It and both of its articles are no longer public.',
    message: (t) => `"${t}" and both of its articles disappear from the website, search, feeds and the vote API straight away. Nothing is deleted and you can publish it again.`,
  },
  publish: {
    title: 'Publish this debate?',
    confirm: 'Publish',
    tone: 'default',
    done: 'Published. The debate and both articles are public again.',
    message: (t) => `"${t}" and both of its articles become public again. It does not become the featured debate automatically.`,
  },
  delete: {
    title: 'Delete this debate?',
    confirm: 'Delete',
    tone: 'danger',
    done: 'Deleted. It is hidden from the public and can be restored.',
    message: (t) => `"${t}" and both of its articles are hidden from the public. Votes are kept and you can restore it later.`,
  },
  restore: {
    title: 'Restore this debate?',
    confirm: 'Restore',
    tone: 'default',
    done: 'Restored as unpublished. Publish it when you are ready.',
    message: (t) => `"${t}" comes back as unpublished. It stays hidden from the public until you publish it.`,
  },
  purge: {
    title: 'Permanently delete this debate?',
    confirm: 'Delete permanently',
    tone: 'danger',
    done: 'Permanently deleted. Its two articles are in the article Trash.',
    message: () => 'This removes the debate and every vote on it for good. It cannot be undone. Its two articles are moved to the article Trash, where the normal retention rules apply.',
  },
}

const chip = {
  published: 'bg-green-500/15 text-green-700',
  unpublished: 'bg-amber-500/15 text-amber-700',
  deleted: 'bg-red-500/15 text-red-600',
} as const

const actionButton =
  'min-h-[36px] border px-3 text-[11px] font-bold uppercase tracking-widest disabled:opacity-50 border-[var(--border-strong)] text-[var(--fg)] hover:border-gold'

export function DebateAdminList({ initialRows, canManage }: { initialRows: DebateAdminRow[]; canManage: boolean }) {
  const [rows, setRows] = useState(initialRows)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<DebateStatusFilter>('all')
  const [pending, setPending] = useState<{ row: DebateAdminRow; action: DebateAction } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // A synchronous latch: state updates are async, so a fast double-click could otherwise
  // send two requests before `busy` re-renders. The server refuses the second anyway.
  const inFlight = useRef(false)

  const visible = useMemo(() => sortDebateRows(filterDebateRows(rows, { query, status })), [rows, query, status])

  async function reload() {
    const fresh = await apiRequest<{ rows: DebateAdminRow[] }>('/api/editorial/debates')
    setRows(fresh.rows)
  }

  async function confirm() {
    if (!pending || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setMessage(null)
    const { row, action } = pending
    try {
      const result = await apiRequest<{ publicCacheRefreshed?: boolean; articlesNotRestored?: number }>(`/api/editorial/debates/${row.id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          expectedUpdatedAt: row.updatedAt,
          ...(action === 'purge' ? { confirmTitle: row.title } : {}),
        }),
      })
      const notRestored = action === 'publish' ? (result.articlesNotRestored ?? 0) : 0
      setMessage({
        ok: result.publicCacheRefreshed !== false && notRestored === 0,
        text:
          ACTION_COPY[action].done +
          (notRestored > 0
            ? ` ${notRestored === 1 ? '1 article was' : `${notRestored} articles were`} not restored because an editor archived, trashed or changed ${notRestored === 1 ? 'it' : 'them'} separately. Republish ${notRestored === 1 ? 'it' : 'them'} from the article editor if that is intended.`
            : '') +
          (result.publicCacheRefreshed === false ? ' Warning: the public site could not be refreshed immediately, so removed pages may still appear for up to 5 minutes.' : ''),
      })
    } catch (reason) {
      setMessage({ ok: false, text: asApiError(reason).message })
    } finally {
      setPending(null)
      // Always re-read: after a stale or conflicting refusal the screen must show the truth.
      await reload().catch(() => setMessage({ ok: false, text: 'The list could not be refreshed. Reload the page.' }))
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="debate-search" className="mb-1 block text-xs uppercase tracking-widest text-[var(--fg-muted)]">Search</label>
          <input
            id="debate-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, article or contributor"
            className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-gold focus:outline-none"
          />
        </div>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={`min-h-[40px] border px-3 text-xs font-bold uppercase tracking-widest ${status === f.value ? 'border-gold bg-navy text-gold' : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-gold'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className={`mb-3 min-h-[1.25rem] text-sm ${message ? (message.ok ? 'text-emerald-600' : 'text-red-500') : 'text-[var(--fg-faint)]'}`}>
        {message?.text ?? `${visible.length} of ${rows.length} debate${rows.length === 1 ? '' : 's'}`}
      </p>

      {visible.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] py-16 text-center">
          <p className="text-sm text-[var(--fg-faint)]">{rows.length === 0 ? 'No debates yet.' : 'No debates match this search.'}</p>
          {rows.length === 0 && (
            <Link href="/editorial/debates/new" className="mt-4 inline-block text-xs font-bold text-gold hover:underline">Create your first debate →</Link>
          )}
        </div>
      ) : (
        <ul className="space-y-4">
          {visible.map((row) => (
            <li key={row.id} data-testid={`debate-${row.id}`} className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] ${chip[row.visibility]}`}>{DEBATE_VISIBILITY_LABEL[row.visibility]}</span>
                {row.featured && <span className="bg-gold/20 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-gold">Featured</span>}
                {row.closed && <span className="bg-[var(--border)] px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[var(--fg-faint)]">Voting closed</span>}
              </div>
              <h2 className="mt-2 text-base font-bold leading-snug text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{row.title}</h2>
              {row.description && <p className="mt-1 text-sm text-[var(--fg-muted)]">{row.description}</p>}

              {row.outOfSync && <p role="alert" className="mt-2 border-l-2 border-amber-500 pl-3 text-xs text-amber-700">{row.outOfSync}</p>}

              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {row.articles.map((a) => (
                  <div key={a.side} className="border border-[var(--border)] p-3">
                    <dt className="text-[0.6rem] font-bold uppercase tracking-widest text-[var(--fg-muted)]">{a.side === 'FOR' ? 'For' : 'Against'}{a.author ? ` · ${a.author}` : ''}</dt>
                    <dd className="mt-1 text-sm font-semibold text-[var(--fg)]">
                      <Link href={`/editorial/articles/${a.id}/edit`} className="hover:underline">{a.title}</Link>
                      <span className="ml-2 text-[10px] font-normal uppercase tracking-widest text-[var(--fg-faint)]">{a.trashed ? 'In trash' : a.status.toLowerCase()}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="mt-3 text-[11px] text-[var(--fg-faint)]">
                {row.votes.total.toLocaleString()} vote{row.votes.total === 1 ? '' : 's'} ({row.votes.for} for, {row.votes.against} against)
                {' · '}Created {format(new Date(row.createdAt), 'd MMM yyyy')}
                {row.publishedAt && <> · Published {format(new Date(row.publishedAt), 'd MMM yyyy')}</>}
                {row.closesAt && <> · Closes {format(new Date(row.closesAt), 'd MMM yyyy')}</>}
                {row.deletedAt && <> · Deleted {format(new Date(row.deletedAt), 'd MMM yyyy')}</>}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/editorial/debates/${row.id}`} className={`${actionButton} inline-flex items-center`}>Results</Link>
                {row.visibility !== 'deleted' && <Link href={`/editorial/debates/${row.id}/edit`} className={`${actionButton} inline-flex items-center`}>Edit</Link>}
                {canManage && row.visibility === 'published' && (
                  <button type="button" disabled={busy} className={actionButton} onClick={() => setPending({ row, action: 'unpublish' })}>Unpublish</button>
                )}
                {canManage && row.visibility === 'unpublished' && (
                  <button type="button" disabled={busy} className={actionButton} onClick={() => setPending({ row, action: 'publish' })}>Publish</button>
                )}
                {canManage && row.visibility === 'deleted' && (
                  <button type="button" disabled={busy} className={actionButton} onClick={() => setPending({ row, action: 'restore' })}>Restore</button>
                )}
                {canManage && row.visibility !== 'deleted' && (
                  <button type="button" disabled={busy} className={`${actionButton} !border-red-500/50 text-red-600`} onClick={() => setPending({ row, action: 'delete' })}>Delete</button>
                )}
                {canManage && row.visibility === 'deleted' && (
                  <button type="button" disabled={busy} className={`${actionButton} !border-red-500/50 text-red-600`} onClick={() => setPending({ row, action: 'purge' })}>Delete permanently</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? ACTION_COPY[pending.action].title : ''}
        message={pending ? ACTION_COPY[pending.action].message(pending.row.title) : ''}
        confirmLabel={pending ? ACTION_COPY[pending.action].confirm : ''}
        tone={pending ? ACTION_COPY[pending.action].tone : 'default'}
        requirePhrase={pending?.action === 'purge' ? pending.row.title : undefined}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => { if (!busy) setPending(null) }}
      />
    </div>
  )
}
