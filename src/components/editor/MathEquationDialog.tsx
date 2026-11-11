'use client'

import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, Trash2, X } from 'lucide-react'
import { renderLatexInto, MAX_LATEX_LENGTH } from '@/lib/math/latex'
import { MATH_TEMPLATE_GROUPS, applyTemplate, type MathTemplate } from '@/lib/math/templates'

export type MathMode = 'inline' | 'display'

interface MathEquationDialogProps {
  /** Starting LaTeX: empty for a new equation, the stored source when editing. */
  initialLatex: string
  initialMode: MathMode
  /** True when editing an existing equation (shows Delete, labels the action "Update"). */
  editing: boolean
  darkMode?: boolean
  onSubmit: (latex: string, mode: MathMode) => void
  onDelete?: () => void
  onCancel: () => void
}

/** Renders a LaTeX string with KaTeX into a span (DOM built by KaTeX, no HTML string). */
function KatexGlyph({ latex, display = false }: { latex: string; display?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (ref.current) renderLatexInto(ref.current, latex, display)
  }, [latex, display])
  return <span ref={ref} aria-hidden="true" className="math-dialog-glyph" />
}

const FOCUSABLE = 'button:not([disabled]), textarea, input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The equation editor opened from the toolbar's Σ button, or by clicking (or
 * pressing Enter on) an equation in the document.
 *
 * Authors who do not know LaTeX build formulas from the template buttons; others
 * type or paste LaTeX. The preview is rendered by the same function the public
 * page uses, so a formula that previews correctly publishes correctly, and the
 * Insert button stays disabled while the formula cannot be typeset. Errors are
 * explained in plain language and never clear the author's input.
 *
 * Keyboard: focus starts in the LaTeX box; Ctrl/⌘+Enter inserts; Escape cancels;
 * Tab is trapped inside the dialog; the template tabs use arrow keys.
 */
export function MathEquationDialog({ initialLatex, initialMode, editing, darkMode, onSubmit, onDelete, onCancel }: MathEquationDialogProps) {
  const [latex, setLatex] = useState(initialLatex)
  const [mode, setMode] = useState<MathMode>(initialMode)
  const [groupId, setGroupId] = useState(MATH_TEMPLATE_GROUPS[0].id)
  const [status, setStatus] = useState<{ ok: boolean; error?: string }>({ ok: false })
  const deferredLatex = useDeferredValue(latex)
  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])
  const ids = useId()
  const titleId = `${ids}-title`
  const latexId = `${ids}-latex`
  const helpId = `${ids}-help`
  const statusId = `${ids}-status`

  // Live preview, rendered by the same safe function as the public page.
  useLayoutEffect(() => {
    const target = previewRef.current
    if (!target) return
    if (!deferredLatex.trim()) {
      target.replaceChildren()
      setStatus({ ok: false })
      return
    }
    const result = renderLatexInto(target, deferredLatex, mode === 'display')
    setStatus(result.ok ? { ok: true } : { ok: false, error: result.error })
  }, [deferredLatex, mode])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
  }, [])

  // Escape and the Tab trap. Registered once; the latest onCancel is read from a ref.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement) : []
      if (!panel || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!active || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // The background page must not scroll behind the dialog.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const insertTemplate = useCallback((template: MathTemplate) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart ?? textarea.value.length
    const end = textarea.selectionEnd ?? start
    const next = applyTemplate(textarea.value, start, end, template)
    setLatex(next.value)
    // Restore focus and the selection after React applies the new value.
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
  }, [])

  // The live status lags the input by a frame (deferred render); only the current text may be inserted.
  const canSubmit = status.ok && deferredLatex === latex && latex.trim().length > 0
  const submit = () => {
    if (canSubmit) onSubmit(latex, mode)
  }

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = MATH_TEMPLATE_GROUPS.length
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % count
    if (event.key === 'ArrowLeft') next = (index - 1 + count) % count
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = count - 1
    if (next < 0) return
    event.preventDefault()
    const id = MATH_TEMPLATE_GROUPS[next].id
    setGroupId(id)
    tabRefs.current[id]?.focus()
  }

  const activeGroup = MATH_TEMPLATE_GROUPS.find((group) => group.id === groupId) ?? MATH_TEMPLATE_GROUPS[0]
  const actionLabel = editing ? 'Update equation' : 'Insert equation'

  return createPortal(
    <div
      className={`math-dialog-backdrop ${darkMode ? 'dark' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="math-dialog" data-testid="math-dialog">
        <header className="math-dialog-header">
          <h2 id={titleId}>{editing ? 'Edit equation' : 'Insert equation'}</h2>
          <button type="button" className="math-dialog-icon-button" onClick={onCancel} aria-label="Close equation editor">
            <X size={16} />
          </button>
        </header>

        <div className="math-dialog-body">
          <fieldset className="math-dialog-mode">
            <legend>Equation type</legend>
            {(
              [
                ['inline', 'Inline', 'Within a sentence'],
                ['display', 'Display', 'On its own line, centred'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className={mode === value ? 'is-selected' : ''}>
                <input type="radio" name={`${ids}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} />
                <span className="math-dialog-mode-label">{label}</span>
                <span className="math-dialog-mode-hint">{hint}</span>
              </label>
            ))}
          </fieldset>

          <div className="math-dialog-templates">
            <div role="tablist" aria-label="Equation templates" className="math-dialog-tabs">
              {MATH_TEMPLATE_GROUPS.map((group, index) => (
                <button
                  key={group.id}
                  ref={(el) => {
                    tabRefs.current[group.id] = el
                  }}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${group.id}`}
                  aria-selected={group.id === groupId}
                  aria-controls={`${ids}-panel`}
                  tabIndex={group.id === groupId ? 0 : -1}
                  onClick={() => setGroupId(group.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {group.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${groupId}`} className={`math-dialog-palette math-dialog-palette--${activeGroup.id}`}>
              {activeGroup.templates.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  title={template.label}
                  aria-label={`Insert ${template.label}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertTemplate(template)}
                >
                  <KatexGlyph latex={template.preview} />
                </button>
              ))}
            </div>
          </div>

          <div className="math-dialog-field">
            <div className="math-dialog-field-head">
              <label htmlFor={latexId}>LaTeX</label>
              <span className={latex.length > MAX_LATEX_LENGTH * 0.9 ? 'is-near-limit' : ''}>
                {latex.length.toLocaleString('en-GB')} / {MAX_LATEX_LENGTH.toLocaleString('en-GB')}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              id={latexId}
              value={latex}
              rows={3}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              aria-describedby={`${helpId} ${statusId}`}
              aria-invalid={Boolean(status.error)}
              placeholder="e.g. Y = C + I + G + (X - M)"
              onChange={(event) => setLatex(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <p id={helpId} className="math-dialog-help">
              Use the buttons above, or type or paste LaTeX. Press Ctrl+Enter (⌘+Enter on a Mac) to {editing ? 'update' : 'insert'}.
            </p>
          </div>

          <div className="math-dialog-preview-wrap">
            <span className="math-dialog-preview-label">Preview</span>
            <div className={`math-dialog-preview ${mode === 'display' ? 'is-display' : ''} ${status.error ? 'has-error' : ''}`} data-testid="math-dialog-preview">
              <div ref={previewRef} className="math-dialog-preview-render" />
              {!latex.trim() && <p className="math-dialog-preview-empty">Your equation will appear here.</p>}
            </div>
            <p id={statusId} role="status" aria-live="polite" className={`math-dialog-status ${status.error ? 'is-error' : status.ok ? 'is-ok' : ''}`}>
              {status.error ? (
                <>
                  <AlertCircle size={14} aria-hidden="true" />
                  <span>
                    <strong>This equation cannot be typeset.</strong> {status.error}
                  </span>
                </>
              ) : status.ok ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  <span>Ready to {editing ? 'update' : 'insert'}.</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <footer className="math-dialog-footer">
          {editing && onDelete && (
            <button type="button" className="math-dialog-delete" onClick={onDelete}>
              <Trash2 size={14} aria-hidden="true" /> Delete equation
            </button>
          )}
          <button type="button" className="math-dialog-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="math-dialog-primary" onClick={submit} disabled={!canSubmit}>
            {actionLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
