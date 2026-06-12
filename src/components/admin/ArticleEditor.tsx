'use client'

import { useRef, useState } from 'react'
import { AlertCircle, MessageSquare, X } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { ArticleEditorDocument } from './article-editor/ArticleEditorDocument'
import { ArticleEditorMetadataPanel } from './article-editor/ArticleEditorMetadataPanel'
import { ArticleEditorMobileSettings } from './article-editor/ArticleEditorMobileSettings'
import { ArticleEditorTopBar } from './article-editor/ArticleEditorTopBar'
import { ArticleEditorTutorial } from './article-editor/ArticleEditorTutorial'
import { useArticleEditorController } from './article-editor/useArticleEditorController'
import type { ArticleEditorController, ArticleEditorProps } from './article-editor/types'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import { CommentsPanel } from '@/components/editorial/CommentsPanel'
import { CommentSelectionPopover } from '@/components/editorial/CommentSelectionPopover'
import { useArticleComments } from '@/components/editorial/useArticleComments'
import { useCommentAnchors } from '@/components/editorial/useCommentAnchors'
import { scrollToCommentHighlight } from '@/components/editor/commentHighlight'

export function ArticleEditor(props: ArticleEditorProps) {
  const coverFileRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<TiptapEditorHandle | null>(null)
  const excerptDomRef = useRef<HTMLTextAreaElement>(null)
  const titleDomRef = useRef<HTMLTextAreaElement>(null)
  const toolbarPortalRef = useRef<HTMLDivElement>(null)

  const editor = useArticleEditorController({
    ...props,
    refs: { coverFileRef, editorRef, excerptDomRef, titleDomRef, toolbarPortalRef },
  })

  // Inline review comments: feedback threads anchored to text in the draft.
  // Highlights are decorations, so they are display-only and never saved
  // into the article content.
  const [liveEditor, setLiveEditor] = useState<Editor | null>(null)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentsDrawerOpen, setCommentsDrawerOpen] = useState(false)
  const { comments, addComment, setCommentResolved } = useArticleComments(editor.articleId)
  const commentAnchors = useCommentAnchors(liveEditor, comments, activeCommentId)
  const openThreadCount = comments.filter((c) => !c.parentId && !c.resolved).length

  const selectComment = (id: string | null) => {
    setActiveCommentId(id)
    if (id && liveEditor) scrollToCommentHighlight(liveEditor, id)
  }

  const handleHighlightClick = (id: string) => {
    setActiveCommentId(id)
    // On narrow screens the panel lives in a drawer; open it so the thread
    // the writer clicked is actually visible.
    if (window.innerWidth < 1100) setCommentsDrawerOpen(true)
  }

  const showComments = Boolean(editor.articleId)

  const commentsPanel = (
    <CommentsPanel
      articleId={editor.articleId ?? ''}
      comments={comments}
      onCommentResolved={setCommentResolved}
      onCommentAdded={addComment}
      activeCommentId={activeCommentId}
      onSelectComment={selectComment}
      anchors={commentAnchors}
    />
  )

  return (
    <div className="min-h-full">
      <ArticleEditorTopBar editor={editor} />

      <div
        ref={toolbarPortalRef}
        className="fixed top-12 left-0 md:left-12 lg:left-[220px] right-0 z-[200]"
      />

      <div className="min-h-screen bg-[var(--bg-subtle)] pt-32 md:pt-28">
        <EditorBanners editor={editor} />

        <div className="flex justify-center gap-6 px-2 sm:px-4 md:px-6 py-4 md:py-8 items-start">
          <ArticleEditorDocument
            editor={editor}
            editorRef={editorRef}
            excerptDomRef={excerptDomRef}
            titleDomRef={titleDomRef}
            toolbarPortalRef={toolbarPortalRef}
            onEditorReady={setLiveEditor}
            onCommentClick={handleHighlightClick}
          />

          <aside className="hidden min-[1100px]:block flex-none w-[280px] sticky top-24 space-y-4">
            {showComments && comments.length > 0 && (
              <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg overflow-hidden shadow-[var(--shadow-card)] max-h-[45vh] overflow-y-auto">
                {commentsPanel}
              </div>
            )}
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-5 overflow-hidden shadow-[var(--shadow-card)]">
              <ArticleEditorMetadataPanel editor={editor} coverFileRef={coverFileRef} />
            </div>
          </aside>
        </div>
      </div>

      {/* Comments on narrow screens: floating toggle plus a slide-over drawer */}
      {showComments && comments.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setCommentsDrawerOpen(true)}
            className="min-[1100px]:hidden fixed bottom-4 right-4 z-[55] flex items-center gap-2 bg-navy text-gold text-xs font-bold px-4 py-3 rounded-full shadow-xl"
            aria-label="Open comments"
          >
            <MessageSquare size={14} />
            Comments
            {openThreadCount > 0 && (
              <span className="bg-gold text-navy text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none">
                {openThreadCount}
              </span>
            )}
          </button>

          <div
            className={`min-[1100px]:hidden fixed inset-0 z-[64] bg-black/40 transition-opacity duration-300 ${commentsDrawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setCommentsDrawerOpen(false)}
            aria-hidden
          />
          <div
            className={`min-[1100px]:hidden fixed inset-y-0 right-0 z-[65] w-[340px] max-w-[92vw] bg-[var(--bg-elevated)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${commentsDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
            aria-hidden={!commentsDrawerOpen}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
              <span className="text-sm font-semibold text-[var(--fg)]">Comments</span>
              <button
                onClick={() => setCommentsDrawerOpen(false)}
                className="text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors p-1.5 rounded-md hover:bg-[var(--bg-subtle)]"
                aria-label="Close comments"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{commentsPanel}</div>
          </div>
        </>
      )}

      {/* Select text in the document to start a new comment thread */}
      {showComments && (
        <CommentSelectionPopover
          editor={liveEditor}
          articleId={editor.articleId ?? ''}
          onCommentCreated={(c) => {
            addComment(c)
            setActiveCommentId(c.id)
          }}
        />
      )}

      <ArticleEditorMobileSettings editor={editor} coverFileRef={coverFileRef} />
      <ArticleEditorTutorial editor={editor} />
    </div>
  )
}

interface EditorBannersProps {
  editor: ArticleEditorController
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
