'use client'

import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ArticleEditorMetadataPanel } from './ArticleEditorMetadataPanel'
import type { ArticleEditorController, ArticleEditorRefs } from './types'

interface ArticleEditorMobileSettingsProps {
  editor: ArticleEditorController
  coverFileRef: ArticleEditorRefs['coverFileRef']
}

export function ArticleEditorMobileSettings({ editor, coverFileRef }: ArticleEditorMobileSettingsProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editor.settingsOpen) return
    const previousFocus = document.activeElement
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [editor.settingsOpen])

  // Closed drawers must not leave off-screen controls in the tab order or
  // duplicate desktop fields. Form state is held by the shared controller.
  if (!editor.settingsOpen) return null

  return (
    <>
      <div
        className="min-[1100px]:hidden fixed inset-0 z-[60] bg-black/40"
        onClick={() => editor.actions.setSettingsOpen(false)}
        aria-hidden
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Document settings"
        className="min-[1100px]:hidden fixed inset-x-0 bottom-0 z-[61] bg-[var(--bg-elevated)] rounded-t-2xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            editor.actions.setSettingsOpen(false)
          } else if (event.key === 'Tab') {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
            )).filter(element => element.getClientRects().length > 0)
            const first = controls[0], last = controls.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-sm font-semibold text-[var(--fg)]">Document settings</span>
          <button
            onClick={() => editor.actions.setSettingsOpen(false)}
            className="text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors p-1.5 rounded-md hover:bg-[var(--bg-subtle)] active:scale-[0.92]"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 flex-1">
          <ArticleEditorMetadataPanel editor={editor} coverFileRef={coverFileRef} />
        </div>
      </div>
    </>
  )
}
