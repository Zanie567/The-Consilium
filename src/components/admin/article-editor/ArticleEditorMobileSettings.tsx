'use client'

import { X } from 'lucide-react'
import { ArticleEditorMetadataPanel } from './ArticleEditorMetadataPanel'
import type { ArticleEditorController } from './types'

interface ArticleEditorMobileSettingsProps {
  editor: ArticleEditorController
}

export function ArticleEditorMobileSettings({ editor }: ArticleEditorMobileSettingsProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-300 ${editor.settingsOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => editor.actions.setSettingsOpen(false)}
        aria-hidden
      />

      <div
        className={`fixed inset-x-0 bottom-0 z-[61] bg-[var(--bg-elevated)] rounded-t-2xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh] transition-transform duration-300 ease-out ${editor.settingsOpen ? 'translate-y-0' : 'translate-y-full'}`}
        aria-hidden={!editor.settingsOpen}
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
          <ArticleEditorMetadataPanel editor={editor} />
        </div>
      </div>
    </>
  )
}
