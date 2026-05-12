'use client'

import { AlertCircle } from 'lucide-react'
import { ArticleEditorDocument } from './article-editor/ArticleEditorDocument'
import { ArticleEditorMetadataPanel } from './article-editor/ArticleEditorMetadataPanel'
import { ArticleEditorMobileSettings } from './article-editor/ArticleEditorMobileSettings'
import { ArticleEditorTopBar } from './article-editor/ArticleEditorTopBar'
import { ArticleEditorTutorial } from './article-editor/ArticleEditorTutorial'
import { useArticleEditorController } from './article-editor/useArticleEditorController'
import type { ArticleEditorProps } from './article-editor/types'

export function ArticleEditor(props: ArticleEditorProps) {
  const editor = useArticleEditorController(props)

  return (
    <div className="min-h-full">
      <ArticleEditorTopBar editor={editor} />

      <div
        ref={editor.refs.toolbarPortalRef}
        className="fixed top-12 left-0 md:left-12 lg:left-[220px] right-0 z-[200]"
      />

      <div className="min-h-screen bg-[var(--bg-subtle)] pt-32 md:pt-28">
        <EditorBanners editor={editor} />

        <div className="flex justify-center gap-6 px-2 sm:px-4 md:px-6 py-4 md:py-8 items-start">
          <ArticleEditorDocument editor={editor} />

          <aside className="hidden min-[1100px]:block flex-none w-[280px] sticky top-24">
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-5 overflow-hidden shadow-[var(--shadow-card)]">
              <ArticleEditorMetadataPanel editor={editor} />
            </div>
          </aside>
        </div>
      </div>

      <ArticleEditorMobileSettings editor={editor} />
      <ArticleEditorTutorial editor={editor} />
    </div>
  )
}

interface EditorBannersProps {
  editor: ReturnType<typeof useArticleEditorController>
}

function EditorBanners({ editor }: EditorBannersProps) {
  if (!editor.initialEditorNote && !editor.error && editor.canEdit) return null

  return (
    <div className="max-w-[1120px] mx-auto px-3 sm:px-6 pt-4 sm:pt-5 space-y-3">
      {editor.initialEditorNote && (
        <div className="bg-amber-500/8 border border-amber-500/20 px-4 py-3 rounded">
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Editor feedback</p>
          <p className="text-sm text-[var(--fg-muted)] leading-relaxed">{editor.initialEditorNote}</p>
        </div>
      )}

      {editor.error && (
        <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 px-4 py-3 rounded text-red-500 text-sm">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {editor.error}
        </div>
      )}

      {!editor.canEdit && (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-3 rounded text-[var(--fg-muted)] text-sm">
          This article is under review and cannot be edited until an editor responds.
        </div>
      )}
    </div>
  )
}
