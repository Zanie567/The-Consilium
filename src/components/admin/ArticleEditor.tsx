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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
  const { comments, error: commentsError, addComment, setCommentResolved } = useArticleComments(editor.articleId)
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
      loadError={commentsError}
    />
  )

  return (
    <div className="min-h-full" data-article-server-version={props.initialData?.version} data-article-server-status={props.initialData?.status}>
      <ArticleEditorTopBar editor={editor} />

      <div
        ref={toolbarPortalRef}
        style={{ top: 'calc(3rem + var(--testing-banner-height, 0px))' }}
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

          {/* Keep the article and its settings as independent scroll surfaces.
              Previously the sticky aside grew with its content, forcing users
              to scroll the entire article just to reach image controls. */}
          <aside
            className="hidden min-[1100px]:flex flex-none w-[280px] sticky min-h-0 flex-col gap-4"
            style={{
              top: 'calc(6rem + var(--testing-banner-height, 0px))',
              height: 'calc(100dvh - 7rem - var(--testing-banner-height, 0px))',
            }}
            aria-label="Article editor sidebar"
          >
            {showComments && (comments.length > 0 || commentsError) && (
              <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-card)] flex-none max-h-[38%] min-h-0 overflow-y-auto overscroll-contain">
                {commentsPanel}
              </div>
            )}
            <div
              role="region"
              aria-label="Article settings (scroll independently)"
              tabIndex={0}
              className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-5 shadow-[var(--shadow-card)] flex-1 min-h-0 overflow-y-auto overscroll-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              <ArticleEditorMetadataPanel editor={editor} coverFileRef={coverFileRef} />
            </div>
          </aside>
        </div>
      </div>

      {/* Comments on narrow screens: floating toggle plus a slide-over drawer */}
      {showComments && (comments.length > 0 || commentsError) && (
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
            className={`min-[1100px]:hidden fixed inset-0 z-[205] bg-black/40 transition-opacity duration-300 ${commentsDrawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setCommentsDrawerOpen(false)}
            aria-hidden
          />
          <div
            className={`min-[1100px]:hidden fixed top-[var(--testing-banner-height,0px)] bottom-0 right-0 z-[206] w-[340px] max-w-[92vw] bg-[var(--bg-elevated)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${commentsDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
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

      <ConfirmDialog
        open={editor.pendingStatus !== null}
        title={confirmCopy(editor.currentStatus, editor.pendingStatus, editor.scheduledAt).title}
        message={confirmCopy(editor.currentStatus, editor.pendingStatus, editor.scheduledAt).message}
        confirmLabel={confirmCopy(editor.currentStatus, editor.pendingStatus, editor.scheduledAt).confirm}
        tone={editor.pendingStatus && !['PUBLISHED', 'SCHEDULED'].includes(editor.pendingStatus) ? 'danger' : 'default'}
        busy={editor.saveStatus === 'saving'}
        onConfirm={() => void editor.actions.confirmStatusChange()}
        onCancel={editor.actions.cancelStatusChange}
      />

      <ConfirmDialog
        open={editor.copyEditPending}
        title="Save as a minor copy edit?"
        message="This article is live, so the change appears to readers immediately. Use this only for spelling, punctuation, formatting, or a better version of the same image, where no fact or meaning changes. The change is recorded internally with the text before and after. A wrong fact, figure, quotation or picture needs a correction, clarification or update from Manage corrections."
        confirmLabel="Save copy edit"
        busy={editor.saveStatus === 'saving'}
        onConfirm={() => void editor.actions.confirmCopyEdit()}
        onCancel={editor.actions.cancelCopyEdit}
      />

      <ArticleEditorMobileSettings editor={editor} coverFileRef={coverFileRef} />
      <ArticleEditorTutorial editor={editor} />
    </div>
  )
}

function confirmCopy(current: string, target: string | null, scheduledAt: string) {
  if (target === 'PUBLISHED') {
    return { title: 'Publish this article?', message: 'It goes live on the public site immediately, visible to every reader.', confirm: 'Publish now' }
  }
  if (target === 'SCHEDULED') {
    return { title: 'Schedule this article?', message: `It will be published automatically at ${scheduledAt.replace('T', ' ')} (UK editorial time).`, confirm: 'Schedule' }
  }
  if (current === 'PUBLISHED' || current === 'SCHEDULED') {
    return { title: 'Take this article down?', message: 'It disappears from the public site immediately. Nothing is deleted.', confirm: 'Unpublish' }
  }
  return { title: 'Change status?', message: '', confirm: 'Confirm' }
}

interface EditorBannersProps {
  editor: ArticleEditorController
}

function EditorBanners({ editor }: EditorBannersProps) {
  const liveNotice = editor.isLive && editor.canPublish && editor.canEdit
  if (!liveNotice && !editor.initialEditorNote && !editor.error && !editor.recovery && !editor.recovered && !editor.recoveryError && editor.canEdit) return null

  return (
    <div className="max-w-[1120px] mx-auto px-3 sm:px-6 pt-4 sm:pt-5 space-y-3">
      {editor.recovery && (
        <div role="alert" className="border border-amber-500 p-4 rounded">
          <p>Unsaved local work from {new Date(editor.recovery.at).toLocaleString()} is available on this device.</p>
          <p>{editor.recovery.stale ? 'The server has changed since this copy. Saving recovered work will require resolving a conflict.' : 'This copy has not been saved to the server.'}</p>
          {editor.canEdit ? <button type="button" onClick={editor.actions.restoreLocalDraft}>Recover local work</button> : <p>This article is locked. Local work cannot replace it.</p>}
          <button type="button" onClick={editor.actions.discardLocalDraft}>Discard local recovery</button>
        </div>
      )}
      {editor.recovered && <p role="status" className="border border-amber-500 p-4">Recovered local work — not server-saved. Review it and press Save draft. Recovery never changes publication status.</p>}
      {editor.recoveryError && <p role="alert">{editor.recoveryError}</p>}
      {liveNotice && (
        <div role="note" className="bg-[var(--bg-elevated)] border border-[var(--border)] border-l-[3px] border-l-gold px-4 py-3 rounded text-sm text-[var(--fg-muted)]" data-testid="live-article-notice">
          <p className="text-[10px] font-bold text-gold uppercase tracking-widest mb-1">Live article</p>
          <p>
            Changes are not saved automatically. Fix spelling, punctuation or formatting here and press
            {' '}<strong>Save changes</strong>; it is recorded as a minor copy edit. If a fact or the meaning changes, use{' '}
            <a href={`/editorial/articles/${editor.articleId}/corrections`} className="text-gold font-semibold underline underline-offset-2">Manage corrections</a>{' '}
            so readers see a dated note.
          </p>
        </div>
      )}
      {editor.initialEditorNote && (
        <div className="bg-amber-500/8 border border-amber-500/20 px-4 py-3 rounded">
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Editor feedback</p>
          <p className="text-sm text-[var(--fg-muted)] leading-relaxed">{editor.initialEditorNote}</p>
        </div>
      )}

      {editor.error && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 px-4 py-3 rounded text-red-500 text-sm"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p>{editor.error.message}</p>
            {editor.error.code === 'ARTICLE_CONFLICT' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={editor.actions.keepMyVersion}
                  className="rounded border border-red-500/40 px-3 py-1 text-xs font-semibold hover:bg-red-500/10"
                >
                  Keep my version
                </button>
                <button
                  type="button"
                  onClick={editor.actions.reloadLatest}
                  className="rounded border border-red-500/40 px-3 py-1 text-xs font-semibold hover:bg-red-500/10"
                >
                  Discard mine and reload
                </button>
              </div>
            )}
            {editor.error.kind === 'auth' && (
              <a
                href="/editorial/login"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block font-semibold underline underline-offset-2 hover:text-red-600"
              >
                Sign in again in a new tab
              </a>
            )}
            {editor.error.requestId && (
              <p className="mt-1 text-[11px] text-red-400">
                Support reference: {editor.error.requestId}
              </p>
            )}
          </div>
        </div>
      )}

      {!editor.canEdit && (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-3 rounded text-[var(--fg-muted)] text-sm">
          {editor.currentStatus === 'PENDING_REVIEW'
            ? 'This article is under review and cannot be edited until an editor responds.'
            : 'This article is no longer a draft, so it cannot be edited by its writer. Ask an editor to unpublish or return it.'}
        </div>
      )}
    </div>
  )
}
