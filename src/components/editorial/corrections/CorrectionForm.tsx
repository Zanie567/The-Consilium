'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Eye, Send, CheckCircle, Wand2 } from 'lucide-react'
import { apiRequest, asApiError, type ApiError } from '@/lib/apiClient'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CorrectionNotice, CorrectionsSection } from '@/components/article/ArticleCorrections'
import {
  CORRECTION_LIMITS,
  CORRECTION_TYPES,
  CORRECTION_TYPE_GUIDANCE,
  CORRECTION_TYPE_LABELS,
  type CorrectionTypeValue,
  type PublicCorrection,
} from '@/lib/corrections/types'
import { suggestPublicNote, textChanged } from '@/lib/corrections/validation'
import { TextChanges } from './TextChanges'
import type { CorrectionRow, ManagerArticle, MutationResult } from './CorrectionsManager'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[320px] border border-[var(--border)] bg-[var(--bg)]" /> },
)

export type FormMode =
  | { kind: 'new' }
  | { kind: 'revise'; correction: CorrectionRow }
  | { kind: 'amend'; target: CorrectionRow }

interface Fields {
  type: CorrectionTypeValue
  originalText: string
  correctedText: string
  publicNote: string
  internalNote: string
  title: string
  excerpt: string
  content: string
}

interface Props {
  article: ManagerArticle
  version: string
  canApprove: boolean
  mode: FormMode
  published: readonly PublicCorrection[]
  onDone: (result: MutationResult) => void
  onCancel: () => void
  /** Reload the article and history after a conflict; resolves with the fresh article. */
  onReload: () => Promise<(ManagerArticle & { version: string }) | null>
}

const draftKey = (articleId: string, mode: FormMode) =>
  `consilium:correction-draft:${articleId}:${mode.kind === 'revise' ? mode.correction.id : mode.kind === 'amend' ? `amend-${mode.target.id}` : 'new'}`

function newRequestKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function initialFields(article: ManagerArticle, mode: FormMode): Fields {
  if (mode.kind === 'revise') {
    const c = mode.correction
    const proposed = c.proposed ?? { title: article.title, excerpt: article.excerpt, content: article.content }
    return {
      type: c.type, originalText: c.originalText ?? '', correctedText: c.correctedText ?? '',
      publicNote: c.publicNote ?? '', internalNote: c.internalNote ?? '',
      title: proposed.title, excerpt: proposed.excerpt ?? '', content: proposed.content,
    }
  }
  return {
    type: mode.kind === 'amend' ? mode.target.type : 'CORRECTION',
    originalText: '', correctedText: '',
    publicNote: mode.kind === 'amend' ? (mode.target.publicNote ?? '') : '',
    internalNote: '',
    title: article.title, excerpt: article.excerpt ?? '', content: article.content,
  }
}

/** A local copy of unsent work keeps the article version its text was based on, so restoring it can never
 *  submit old text against a newer version (the server then answers ARTICLE_CHANGED and offers a reload). */
interface StoredDraft { fields: Fields; baseVersion: string }

function readDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredDraft>) : null
    return parsed?.fields && typeof parsed.baseVersion === 'string' ? (parsed as StoredDraft) : null
  } catch {
    return null
  }
}

/** The version the form's initial text belongs to: a pending correction's own base, otherwise the live article. */
function initialBaseVersion(version: string, mode: FormMode): string {
  return mode.kind === 'revise' && mode.correction.baseVersion ? mode.correction.baseVersion : version
}

export function CorrectionForm({ article, version, canApprove, mode, published, onDone, onCancel, onReload }: Props) {
  const key = draftKey(article.id, mode)
  const [fields, setFields] = useState<Fields>(() => initialFields(article, mode))
  const [restored, setRestored] = useState(false)
  const [baseVersion, setBaseVersion] = useState(() => initialBaseVersion(version, mode))
  const [baseArticle, setBaseArticle] = useState(article)
  const [editorKey, setEditorKey] = useState(0)
  const [requestKey] = useState(newRequestKey)
  const [error, setError] = useState<ApiError | null>(null)
  const [localError, setLocalError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'publish' | 'submit' | null>(null)
  const [preview, setPreview] = useState<{ html: string; at: string } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [staleText, setStaleText] = useState<{ title: string; excerpt: string; content: string } | null>(null)
  const submitting = useRef(false)

  // Bring back unsent work from this device (a failed save never loses the editor's text).
  useEffect(() => {
    const saved = readDraft(key)
    if (saved) {
      setFields(saved.fields)
      setBaseVersion(saved.baseVersion)
      setEditorKey((k) => k + 1)
      setRestored(true)
    }
  }, [key])

  useEffect(() => {
    try {
      const draft: StoredDraft = { fields, baseVersion }
      localStorage.setItem(key, JSON.stringify(draft))
    } catch { /* storage unavailable: the form still holds the text */ }
  }, [key, fields, baseVersion])

  const set = useCallback(<K extends keyof Fields>(field: K, value: Fields[K]) => {
    setFields((current) => ({ ...current, [field]: value }))
    setPreview(null)
  }, [])

  const isAmendment = mode.kind === 'amend' || (mode.kind === 'revise' && Boolean(mode.correction.supersedesId))
  const proposedText = { title: fields.title.trim(), excerpt: fields.excerpt.trim() ? fields.excerpt : null, content: fields.content }
  const liveText = { title: baseArticle.title, excerpt: baseArticle.excerpt, content: baseArticle.content }
  const hasTextChange = textChanged(liveText, proposedText)

  const validate = (): string => {
    if (fields.type === 'CORRECTION' && (!fields.originalText.trim() || !fields.correctedText.trim())) {
      return 'Record what the article originally said and what is correct (step 2).'
    }
    if (fields.type === 'CLARIFICATION' && !fields.originalText.trim()) return 'Record the statement that could mislead readers (step 2).'
    if (fields.type === 'CORRECTION' && !isAmendment && !hasTextChange) {
      return 'A correction must amend the article itself. Change the incorrect passage in step 3, or choose clarification or update.'
    }
    if (!fields.title.trim()) return 'The article needs a headline.'
    if (!fields.publicNote.trim()) return 'Write the public note readers will see (step 4).'
    if (fields.publicNote.trim().length > CORRECTION_LIMITS.publicNote) return `The public note must be ${CORRECTION_LIMITS.publicNote} characters or fewer.`
    return ''
  }

  const showPreview = async () => {
    setPreviewError('')
    try {
      const data = await apiRequest<{ html: string }>(`/api/editorial/articles/${article.id}/corrections/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: fields.content }),
      })
      setPreview({ html: data.html, at: new Date().toISOString() })
    } catch (reason) {
      setPreviewError(asApiError(reason).message)
    }
  }

  const ask = (intent: 'publish' | 'submit') => {
    const problem = validate()
    setLocalError(problem)
    setError(null)
    if (!problem) setConfirm(intent)
  }

  const send = async (intent: 'publish' | 'submit') => {
    if (submitting.current) return // double click / key repeat
    submitting.current = true
    setBusy(true)
    setError(null)
    const payload = {
      type: fields.type,
      originalText: fields.originalText,
      correctedText: fields.correctedText,
      publicNote: fields.publicNote,
      internalNote: fields.internalNote,
      title: proposedText.title,
      excerpt: proposedText.excerpt,
      content: proposedText.content,
      baseVersion,
      supersedesId: mode.kind === 'amend' ? mode.target.id : mode.kind === 'revise' ? mode.correction.supersedesId : null,
    }
    try {
      let result: MutationResult
      if (mode.kind === 'revise') {
        result = await apiRequest<MutationResult>(`/api/editorial/articles/${article.id}/corrections/${mode.correction.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'revise', ...payload, expectedUpdatedAt: mode.correction.updatedAt }),
        })
      } else {
        result = await apiRequest<MutationResult>(`/api/editorial/articles/${article.id}/corrections`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, requestKey, publish: intent === 'publish', confirm: intent === 'publish' }),
        })
      }
      try { localStorage.removeItem(key) } catch { /* nothing to clear */ }
      onDone(result)
    } catch (reason) {
      setError(asApiError(reason))
    } finally {
      submitting.current = false
      setBusy(false)
      setConfirm(null)
    }
  }

  const reloadArticle = async () => {
    const fresh = await onReload()
    if (!fresh) return
    // Keep the editor's amendment for reference, then start again from the current text.
    setStaleText({ title: fields.title, excerpt: fields.excerpt, content: fields.content })
    setBaseArticle(fresh)
    setBaseVersion(fresh.version)
    setFields((current) => ({ ...current, title: fresh.title, excerpt: fresh.excerpt ?? '', content: fresh.content }))
    setEditorKey((k) => k + 1)
    setError(null)
    setPreview(null)
  }

  const discardRestored = () => {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
    setFields(initialFields(article, mode))
    setBaseVersion(initialBaseVersion(version, mode))
    setEditorKey((k) => k + 1)
    setRestored(false)
  }

  const previewCorrections: PublicCorrection[] = useMemo(() => [
    ...published,
    {
      id: 'preview', type: fields.type, publicNote: fields.publicNote.trim() || '(Public note)',
      publishedAt: preview?.at ?? new Date().toISOString(), legacy: false,
      supersedesId: mode.kind === 'amend' ? mode.target.id : mode.kind === 'revise' ? mode.correction.supersedesId : null,
    },
  ], [published, fields.type, fields.publicNote, preview?.at, mode])

  const heading = mode.kind === 'revise' ? 'Revise the pending correction' : mode.kind === 'amend' ? 'Amend a published note' : 'New correction'
  const publishLabel = mode.kind === 'revise' ? 'Save revision' : canApprove ? 'Publish…' : 'Submit for approval…'

  return (
    <section aria-labelledby="correction-form-heading" className="border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'publish' ? `Publish this ${CORRECTION_TYPE_LABELS[fields.type].toLowerCase()}?` : mode.kind === 'revise' ? 'Save this revision?' : 'Submit for approval?'}
        message={confirm === 'publish'
          ? `${hasTextChange ? 'The article text changes immediately and the' : 'The'} note is added to the public record with today's date. Published notes are permanent: they can be amended later, never deleted. The original publication date does not change.`
          : 'Nothing changes on the public site until an administrator approves it. You can revise or withdraw it until then.'}
        confirmLabel={confirm === 'publish' ? 'Publish now' : mode.kind === 'revise' ? 'Save revision' : 'Submit'}
        busy={busy}
        onConfirm={() => { if (confirm && !busy) void send(confirm) }}
        onCancel={() => { if (!busy) setConfirm(null) }}
      />

      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-6">
        <h2 id="correction-form-heading" className="text-xs font-bold uppercase tracking-widest text-[var(--fg)]">{heading}</h2>
        <button type="button" onClick={onCancel} className="text-xs text-[var(--fg-faint)] hover:text-gold">Close</button>
      </header>

      <div className="space-y-8 px-4 py-5 sm:px-6">
        {restored && (
          <p role="status" className="border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-[var(--fg-muted)]">
            Restored your unsent work on this device.{' '}
            <button type="button" onClick={discardRestored} className="font-semibold text-gold underline underline-offset-2">Start again instead</button>
          </p>
        )}
        {mode.kind === 'amend' && (
          <p className="border-l-[3px] border-gold bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--fg-muted)]">
            The earlier note stays on the public record unchanged; readers see your amendment beneath it, linked to it.
          </p>
        )}

        <Step n={1} title="What kind of change is this?">
          <fieldset>
            <legend className="sr-only">Type of notice</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CORRECTION_TYPES.map((type) => (
                <label
                  key={type}
                  className={`flex cursor-pointer flex-col gap-1 border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-gold/60 ${fields.type === type ? 'border-gold bg-gold/5' : 'border-[var(--border)] hover:border-gold/50'}`}
                >
                  <span className="flex items-center gap-2 font-semibold text-[var(--fg)]">
                    <input type="radio" name="correction-type" value={type} checked={fields.type === type} onChange={() => set('type', type)} className="accent-gold" />
                    {CORRECTION_TYPE_LABELS[type]}
                  </span>
                  <span className="text-xs leading-relaxed text-[var(--fg-faint)]">{CORRECTION_TYPE_GUIDANCE[type]}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--fg-faint)]">
              Spelling, punctuation or formatting only? Use <strong>Save changes</strong> in the article editor instead; no public note is needed.
            </p>
          </fieldset>
        </Step>

        <Step n={2} title="What was wrong, and what is right?">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={fields.type === 'UPDATE' ? 'What has changed (optional)' : 'What the article said'} hint="Internal record. Quote the passage.">
              <textarea value={fields.originalText} onChange={(e) => set('originalText', e.target.value)} rows={3} maxLength={CORRECTION_LIMITS.originalText} className={inputClass} />
            </Field>
            <Field label={fields.type === 'CORRECTION' ? 'What is correct' : fields.type === 'CLARIFICATION' ? 'The context readers need (optional)' : 'The new information (optional)'} hint="Internal record.">
              <textarea value={fields.correctedText} onChange={(e) => set('correctedText', e.target.value)} rows={3} maxLength={CORRECTION_LIMITS.correctedText} className={inputClass} />
            </Field>
          </div>
        </Step>

        <Step n={3} title="Amend the article">
          <div className="space-y-3">
            <Field label="Headline">
              <input value={fields.title} onChange={(e) => set('title', e.target.value)} maxLength={CORRECTION_LIMITS.title} className={inputClass} />
            </Field>
            <Field label="Standfirst">
              <textarea value={fields.excerpt} onChange={(e) => set('excerpt', e.target.value)} rows={2} maxLength={CORRECTION_LIMITS.excerpt} className={inputClass} />
            </Field>
            <div>
              <p className={labelClass}>Article text</p>
              <div className="border border-[var(--border)]">
                <TiptapEditor key={editorKey} ariaLabel="Article text" content={fields.content} onChange={(value: string) => set('content', value)} />
              </div>
            </div>
            <details className="border border-[var(--border)] bg-[var(--bg)] px-3 py-2" open={hasTextChange}>
              <summary className="cursor-pointer text-xs font-semibold text-[var(--fg-muted)]">
                {hasTextChange ? 'Your changes to the live article' : 'No changes to the article text yet'}
              </summary>
              <div className="mt-2">
                <TextChanges before={liveText} after={proposedText} />
              </div>
            </details>
            {staleText && (
              <details className="border border-amber-500/40 bg-amber-500/5 px-3 py-2" open>
                <summary className="cursor-pointer text-xs font-semibold text-[var(--fg-muted)]">Your earlier amendment, for reference (re-apply it above)</summary>
                <div className="mt-2">
                  <TextChanges before={liveText} after={{ ...staleText, excerpt: staleText.excerpt || null }} emptyMessage="Your earlier version matches the current text." />
                </div>
              </details>
            )}
          </div>
        </Step>

        <Step n={4} title="The public note">
          <Field
            label="What readers will see"
            hint={`Say what was wrong and what is correct, plainly. ${fields.publicNote.trim().length}/${CORRECTION_LIMITS.publicNote}`}
          >
            <textarea
              value={fields.publicNote}
              onChange={(e) => set('publicNote', e.target.value)}
              rows={4}
              maxLength={CORRECTION_LIMITS.publicNote}
              className={inputClass}
              placeholder="An earlier version of this article stated that unemployment had risen to 5.2%. The correct figure was 4.8%. The article has been amended."
            />
          </Field>
          <button
            type="button"
            onClick={() => set('publicNote', suggestPublicNote(fields.type, fields.originalText, fields.correctedText))}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-gold hover:underline"
          >
            <Wand2 size={12} /> Draft it from step 2
          </button>
        </Step>

        <Step n={5} title="Evidence and internal context">
          <Field label="Sources, who raised it, anything the approver should know" hint="Never shown publicly.">
            <textarea value={fields.internalNote} onChange={(e) => set('internalNote', e.target.value)} rows={3} maxLength={CORRECTION_LIMITS.internalNote} className={inputClass} />
          </Field>
        </Step>

        <Step n={6} title="Preview">
          <button type="button" onClick={() => void showPreview()} className="inline-flex min-h-[44px] items-center gap-2 border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:border-gold hover:text-gold">
            <Eye size={14} /> {preview ? 'Refresh preview' : 'Show preview'}
          </button>
          {previewError && <p role="alert" className="mt-2 text-sm text-red-500">{previewError}</p>}
          {preview && (
            <div className="mt-4 border border-dashed border-gold/50 bg-[var(--bg)] p-4 sm:p-8" data-testid="correction-preview">
              <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-gold/70">Preview: as readers will see it</p>
              <div className="mx-auto max-w-[680px]">
                <CorrectionNotice corrections={previewCorrections} />
                <h3 className="mb-4 text-3xl font-extrabold leading-tight text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{proposedText.title}</h3>
                {proposedText.excerpt && <p className="mb-6 border-l-[3px] border-gold pl-5 text-lg italic text-[var(--fg-muted)]">{proposedText.excerpt}</p>}
                {/* Sanitised by the same server renderer as the public article page. */}
                <div className="prose-consilium" dangerouslySetInnerHTML={{ __html: preview.html }} />
                <CorrectionsSection corrections={previewCorrections} />
              </div>
            </div>
          )}
        </Step>

        {(localError || error) && (
          <div role="alert" className="border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            <p>{localError || error?.message}</p>
            {error?.code === 'ARTICLE_CHANGED' && (
              <button type="button" onClick={() => void reloadArticle()} className="mt-2 rounded border border-red-500/40 px-3 py-1 text-xs font-semibold hover:bg-red-500/10">
                Load the current article (keeps your notes)
              </button>
            )}
            {error && !localError && <p className="mt-1 text-xs text-red-400">Your text is still in this form{error.requestId ? ` · reference ${error.requestId}` : ''}.</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5">
          {mode.kind === 'revise' ? (
            <PrimaryButton onClick={() => ask('submit')} disabled={busy} icon={<Send size={14} />}>{busy ? 'Saving…' : publishLabel}</PrimaryButton>
          ) : canApprove ? (
            <>
              <PrimaryButton onClick={() => ask('publish')} disabled={busy} icon={<CheckCircle size={14} />}>{busy ? 'Publishing…' : `Publish ${CORRECTION_TYPE_LABELS[fields.type].toLowerCase()}…`}</PrimaryButton>
              <button type="button" onClick={() => ask('submit')} disabled={busy} className="min-h-[44px] border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:border-gold hover:text-gold disabled:opacity-60">
                Save for approval later
              </button>
            </>
          ) : (
            <PrimaryButton onClick={() => ask('submit')} disabled={busy} icon={<Send size={14} />}>{busy ? 'Submitting…' : publishLabel}</PrimaryButton>
          )}
          <p className="text-xs text-[var(--fg-faint)]">
            {canApprove
              ? 'You approve this as a senior editor; your name is recorded as the approver.'
              : 'An administrator approves corrections before they are published.'}
          </p>
        </div>
      </div>
    </section>
  )
}

const labelClass = 'mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]'
const inputClass = 'w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-gold/40'

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-[var(--fg)]">
        <span className="text-xs font-bold text-gold" aria-hidden="true">{n}</span>
        {title}
      </h3>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--fg-faint)]">{hint}</span>}
    </label>
  )
}

function PrimaryButton({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex min-h-[44px] items-center justify-center gap-2 bg-navy px-5 py-3 text-xs font-bold uppercase tracking-widest text-gold hover:bg-navy-dark disabled:opacity-60">
      {icon}
      {children}
    </button>
  )
}
