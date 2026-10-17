'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ExternalLink, FilePlus2 } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatCorrectionDate } from '@/components/article/ArticleCorrections'
import {
  CORRECTION_TYPE_LABELS,
  type CorrectionStatusValue,
  type CorrectionTypeValue,
  type PublicCorrection,
} from '@/lib/corrections/types'
import { CorrectionForm, type FormMode } from './CorrectionForm'
import { TextChanges } from './TextChanges'

interface StoredText { title: string; excerpt: string | null; content: string; coverImage?: string | null; authorId?: string; authorName?: string | null }

export interface CorrectionRow {
  id: string
  type: CorrectionTypeValue
  status: CorrectionStatusValue
  publicNote: string | null
  originalText: string | null
  correctedText: string | null
  internalNote: string | null
  baseVersion: string | null
  proposed: StoredText | null
  previous: StoredText | null
  supersedesId: string | null
  legacy: boolean
  createdById: string | null
  createdByName: string | null
  approvedById: string | null
  approvedByName: string | null
  withdrawnReason: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  withdrawnAt: string | null
}

export interface ManagerArticle {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  coverImage: string | null
  authorId: string
  authorName: string | null
  status: string
  publishedAt: string | null
  updatedAt: string
}

export interface ManagerData {
  article: ManagerArticle
  version: string
  viewer: { id: string; canApprove: boolean }
  /** Accounts a byline may name. */
  authors: { id: string; name: string | null; role: string }[]
  corrections: CorrectionRow[]
  copyEdits: { id: string; createdAt: string; editorName: string; fields: string[] }[]
}

export interface MutationResult {
  correction: CorrectionRow
  published: boolean
  replayed: boolean
  warnings: { stage: string; message: string }[]
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const when = (iso: string) => DATE_TIME.format(new Date(iso))

export function CorrectionsManager({ initialData }: { initialData: ManagerData }) {
  const [data, setData] = useState(initialData)
  const [mode, setMode] = useState<FormMode | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState<'publish' | 'withdraw' | null>(null)
  const [withdrawReason, setWithdrawReason] = useState('')

  const { article, viewer } = data
  const isPublished = article.status === 'PUBLISHED'
  const pending = data.corrections.find((c) => c.status === 'PENDING') ?? null
  const published = useMemo<PublicCorrection[]>(() => data.corrections
    .filter((c) => c.status === 'PUBLISHED')
    .sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? '') || a.createdAt.localeCompare(b.createdAt))
    .map((c) => ({ id: c.id, type: c.type, publicNote: c.publicNote, publishedAt: c.publishedAt, legacy: c.legacy, supersedesId: c.supersedesId })),
  [data.corrections])
  const amendedIds = new Set(data.corrections.filter((c) => c.supersedesId && c.status !== 'WITHDRAWN').map((c) => c.supersedesId))

  const reload = async (): Promise<ManagerData | null> => {
    try {
      const fresh = await apiRequest<ManagerData>(`/api/editorial/articles/${article.id}/corrections`, { cache: 'no-store' })
      setData(fresh)
      return fresh
    } catch (reason) {
      setError(asApiError(reason).message)
      return null
    }
  }

  const openForm = (next: FormMode) => {
    setNotice(null)
    setError('')
    setMode(next)
    setFormKey((k) => k + 1)
  }

  const done = async (result: MutationResult, fallback: string) => {
    setMode(null)
    const label = CORRECTION_TYPE_LABELS[result.correction.type].toLowerCase()
    const text = result.replayed
      ? `This ${label} had already been ${result.published ? 'published' : 'submitted'}; nothing was duplicated.`
      : result.published
        ? `The ${label} is published. The article and its public note are live.`
        : fallback
    setNotice({ text, warnings: result.warnings.map((w) => w.message) })
    await reload()
  }

  const actOnPending = async (action: 'publish' | 'withdraw') => {
    if (!pending || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<MutationResult>(`/api/editorial/articles/${article.id}/corrections/${pending.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'publish'
          ? { action, confirm: true, expectedUpdatedAt: pending.updatedAt }
          : { action, reason: withdrawReason, expectedUpdatedAt: pending.updatedAt }),
      })
      setWithdrawReason('')
      await done(result, 'The pending correction was withdrawn. Nothing changed on the public site.')
    } catch (reason) {
      setError(asApiError(reason).message)
      await reload()
    } finally {
      setBusy(false)
      setPendingAction(null)
    }
  }

  const canChangePending = pending && (viewer.canApprove || pending.createdById === viewer.id)
  const liveText = { title: article.title, excerpt: article.excerpt, content: article.content, coverImage: article.coverImage, authorId: article.authorId, authorName: article.authorName }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction === 'publish' ? `Approve and publish this ${pending ? CORRECTION_TYPE_LABELS[pending.type].toLowerCase() : 'correction'}?` : 'Withdraw this correction?'}
        message={pendingAction === 'publish'
          ? 'The article text changes immediately and the note is added to the public record with today\'s date. Published notes are permanent: they can be amended, never deleted.'
          : 'It will not be published. It stays in this article\'s internal history with your reason.'}
        confirmLabel={pendingAction === 'publish' ? 'Approve and publish' : 'Withdraw'}
        tone={pendingAction === 'withdraw' ? 'danger' : 'default'}
        busy={busy}
        onConfirm={() => { if (pendingAction) void actOnPending(pendingAction) }}
        onCancel={() => { if (!busy) setPendingAction(null) }}
      />

      <div className="mx-auto max-w-[1100px] space-y-6">
        <header className="flex items-start gap-4 pl-10 md:pl-0">
          <Link href="/editorial/articles" aria-label="Back to articles" className="mt-1 text-[var(--fg-faint)] hover:text-gold"><ArrowLeft size={18} /></Link>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gold/70">Manage corrections</p>
            <h1 className="text-2xl font-bold leading-tight text-[var(--fg)] sm:text-3xl" style={{ fontFamily: 'var(--font-serif)' }}>{article.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--fg-faint)]">
              {article.publishedAt && <span>First published {formatCorrectionDate(article.publishedAt)}</span>}
              <span className="uppercase tracking-widest">{article.status.replace('_', ' ')}</span>
              {isPublished && (
                <a href={`/articles/${article.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gold hover:underline">
                  View live <ExternalLink size={11} />
                </a>
              )}
              <Link href={`/editorial/articles/${article.id}/edit`} className="text-gold hover:underline">Open in editor</Link>
            </div>
          </div>
        </header>

        {notice && (
          <div role="status" className="border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <p>{notice.text}</p>
            {notice.warnings.map((warning) => <p key={warning} className="mt-1 text-amber-700 dark:text-amber-300">{warning}</p>)}
          </div>
        )}
        {error && <p role="alert" className="border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</p>}

        {!isPublished && (
          <Panel title="Not published">
            <p className="text-sm text-[var(--fg-muted)]">
              Only a published article can be corrected. Drafts, scheduled and unpublished articles are edited in the article editor;
              this article&apos;s correction history is kept below and reappears if it is published again.
            </p>
          </Panel>
        )}

        {pending && mode?.kind !== 'revise' && (
          <Panel title="Awaiting approval" accent>
            <div className="space-y-4 text-sm" data-testid="pending-correction">
              <p className="text-[var(--fg-muted)]">
                <strong className="text-[var(--fg)]">{CORRECTION_TYPE_LABELS[pending.type]}</strong>
                {pending.supersedesId && ' (amending an earlier note)'} prepared by {pending.createdByName ?? 'an editor'} on {when(pending.createdAt)}
                {pending.updatedAt !== pending.createdAt && `, last revised ${when(pending.updatedAt)}`}.
              </p>
              <Detail label="Public note"><p className="whitespace-pre-line text-[var(--fg)]">{pending.publicNote}</p></Detail>
              {(pending.originalText || pending.correctedText) && (
                <div className="grid gap-3 md:grid-cols-2">
                  {pending.originalText && <Detail label="What the article said"><p className="whitespace-pre-line">{pending.originalText}</p></Detail>}
                  {pending.correctedText && <Detail label="What is correct"><p className="whitespace-pre-line">{pending.correctedText}</p></Detail>}
                </div>
              )}
              {pending.internalNote && <Detail label="Internal context (never public)"><p className="whitespace-pre-line">{pending.internalNote}</p></Detail>}
              {pending.proposed && (
                <Detail label="Changes to the live article">
                  <TextChanges before={liveText} after={pending.proposed} />
                  {pending.baseVersion !== data.version && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      The article has changed since this was prepared, so it cannot be published as it stands. Revise it against the current text.
                    </p>
                  )}
                </Detail>
              )}

              {pendingAction === null && canChangePending && (
                <div className="space-y-3 border-t border-[var(--border)] pt-4">
                  <div className="flex flex-wrap gap-3">
                    {viewer.canApprove && isPublished && (
                      <button type="button" onClick={() => setPendingAction('publish')} disabled={busy || pending.baseVersion !== data.version}
                        className="min-h-[44px] bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-emerald-700 disabled:opacity-60">
                        Approve and publish…
                      </button>
                    )}
                    <button type="button" onClick={() => openForm({ kind: 'revise', correction: pending })} disabled={busy || !isPublished}
                      className="min-h-[44px] border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:border-gold hover:text-gold disabled:opacity-60">
                      Revise
                    </button>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">Withdraw instead: reason (internal)</span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} maxLength={1000}
                        className="min-h-[44px] flex-1 border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-gold" />
                      <button type="button" onClick={() => setPendingAction('withdraw')} disabled={busy || !withdrawReason.trim()}
                        className="min-h-[44px] border border-red-500/40 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-500 disabled:opacity-60">
                        Withdraw…
                      </button>
                    </div>
                  </label>
                </div>
              )}
              {!canChangePending && (
                <p className="text-xs text-[var(--fg-faint)]">Only the editor who prepared it or an administrator can change it.</p>
              )}
            </div>
          </Panel>
        )}

        {mode ? (
          <CorrectionForm
            key={formKey}
            article={article}
            version={data.version}
            canApprove={viewer.canApprove}
            authors={data.authors}
            mode={mode}
            published={published}
            onCancel={() => setMode(null)}
            onDone={(result) => void done(result, mode.kind === 'revise'
              ? 'The pending correction was revised. It still needs approval.'
              : 'Submitted for approval. Administrators have been notified; nothing changes publicly until it is approved.')}
            onReload={async () => {
              const fresh = await reload()
              return fresh ? { ...fresh.article, version: fresh.version } : null
            }}
          />
        ) : (
          isPublished && !pending && (
            <button type="button" onClick={() => openForm({ kind: 'new' })}
              className="inline-flex min-h-[44px] items-center gap-2 bg-navy px-5 py-3 text-xs font-bold uppercase tracking-widest text-gold hover:bg-navy-dark">
              <FilePlus2 size={14} /> New correction, clarification or update
            </button>
          )
        )}

        <Panel title={`History (${data.corrections.length})`}>
          {data.corrections.length === 0 ? (
            <p className="text-sm text-[var(--fg-faint)]">No corrections, clarifications or updates have been issued for this article.</p>
          ) : (
            <ol className="space-y-4" data-testid="correction-history">
              {data.corrections.map((c) => (
                <li key={c.id} className={`border-l-[3px] pl-4 text-sm ${c.status === 'PUBLISHED' ? 'border-gold' : c.status === 'PENDING' ? 'border-amber-500' : 'border-[var(--border)] opacity-70'}`}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg)]">
                    {CORRECTION_TYPE_LABELS[c.type]}
                    <span className="mx-2 font-normal text-[var(--fg-faint)]">|</span>
                    <span className="font-normal normal-case tracking-normal">
                      {c.status === 'PUBLISHED'
                        ? c.publishedAt ? `Published ${when(c.publishedAt)}` : 'Published (date not recorded)'
                        : c.status === 'PENDING' ? 'Awaiting approval' : `Withdrawn ${c.withdrawnAt ? when(c.withdrawnAt) : ''}`}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[var(--fg-muted)]">{c.publicNote ?? '(No note was recorded.)'}</p>
                  <p className="mt-1 text-xs text-[var(--fg-faint)]">
                    {c.legacy
                      ? 'Carried over from the previous single-note corrections field; its original date was never recorded.'
                      : <>Prepared by {c.createdByName ?? 'unknown'} · {when(c.createdAt)}{c.approvedByName && <> · approved by {c.approvedByName}</>}</>}
                    {c.supersedesId && ' · amends an earlier note'}
                    {c.withdrawnReason && <> · reason: {c.withdrawnReason}</>}
                  </p>
                  {c.status === 'PUBLISHED' && c.previous && c.proposed && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-gold">Text changed by this notice</summary>
                      <div className="mt-2"><TextChanges before={c.previous} after={c.proposed} /></div>
                    </details>
                  )}
                  {c.status === 'PUBLISHED' && isPublished && !pending && !mode && !amendedIds.has(c.id) && (
                    <button type="button" onClick={() => openForm({ kind: 'amend', target: c })} className="mt-2 text-xs font-semibold text-[var(--fg-muted)] hover:text-gold hover:underline">
                      Amend this note
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-[var(--fg-faint)]">
            Published notes are permanent. A mistake in one is fixed with an amendment, which appears beneath it on the article.
          </p>
        </Panel>

        <Panel title={`Minor copy edits since publication (${data.copyEdits.length})`}>
          {data.copyEdits.length === 0 ? (
            <p className="text-sm text-[var(--fg-faint)]">None recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm text-[var(--fg-muted)]">
              {data.copyEdits.map((edit) => (
                <li key={edit.id}>{when(edit.createdAt)} · {edit.editorName} · {edit.fields.join(', ') || 'text'}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--fg-faint)]">Internal only. Each copy edit keeps the text before and after in the audit log.</p>
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, accent, children }: { title: string; accent?: boolean; children: ReactNode }) {
  return (
    <section className={`border bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)] sm:p-6 ${accent ? 'border-amber-500/40' : 'border-[var(--border)]'}`}>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[var(--fg)]">{title}</h2>
      {children}
    </section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">{label}</p>
      <div className="text-[var(--fg-muted)]">{children}</div>
    </div>
  )
}
