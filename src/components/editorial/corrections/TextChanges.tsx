'use client'

import { describeTextChanges, type TextVersion } from '@/lib/corrections/diff'

/** The passages a correction changes, before and after, with one passage of context. */
export function TextChanges({ before, after, emptyMessage = 'The article text is unchanged.' }: {
  before: TextVersion
  after: TextVersion
  emptyMessage?: string
}) {
  const changes = describeTextChanges(before, after)
  if (!changes.changed) return <p className="text-xs text-[var(--fg-faint)]">{emptyMessage}</p>

  return (
    <div className="space-y-2 text-sm" data-testid="text-changes">
      {changes.title && <FieldChange label="Headline" before={changes.title.before} after={changes.title.after} />}
      {changes.excerpt && <FieldChange label="Standfirst" before={changes.excerpt.before} after={changes.excerpt.after} />}
      {changes.passages.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
            Article text · {changes.changedPassages} passage{changes.changedPassages === 1 ? '' : 's'} changed
          </p>
          <ul className="space-y-1">
            {changes.passages.map((passage, index) =>
              passage.kind === 'gap' ? (
                <li key={index} aria-hidden="true" className="text-center text-xs text-[var(--fg-faint)]">⋯</li>
              ) : (
                <li
                  key={index}
                  className={
                    passage.kind === 'removed'
                      ? 'border-l-2 border-red-500/60 bg-red-500/5 px-3 py-1.5 text-[var(--fg-muted)] line-through decoration-red-500/40'
                      : passage.kind === 'added'
                        ? 'border-l-2 border-emerald-500/60 bg-emerald-500/5 px-3 py-1.5 text-[var(--fg)]'
                        : 'px-3 py-1 text-[var(--fg-faint)]'
                  }
                >
                  <span className="sr-only">{passage.kind === 'removed' ? 'Removed: ' : passage.kind === 'added' ? 'Added: ' : 'Unchanged: '}</span>
                  {passage.text}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function FieldChange({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">{label}</p>
      <p className="border-l-2 border-red-500/60 bg-red-500/5 px-3 py-1.5 text-[var(--fg-muted)] line-through decoration-red-500/40">
        <span className="sr-only">Removed: </span>{before || '(empty)'}
      </p>
      <p className="mt-1 border-l-2 border-emerald-500/60 bg-emerald-500/5 px-3 py-1.5 text-[var(--fg)]">
        <span className="sr-only">Added: </span>{after || '(empty)'}
      </p>
    </div>
  )
}
