'use client'

import dynamic from 'next/dynamic'
import { useRef } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type React from 'react'
import type { Editor } from '@tiptap/react'
import type { TiptapEditorHandle } from '@/components/editor/TiptapEditor'
import type { ArticleEditorController, ArticleEditorRefs } from './types'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((module) => module.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[400px]" /> }
) as React.ForwardRefExoticComponent<
  {
    content?: string
    onChange: (content: string) => void
    editable?: boolean
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
    toolbarPortalRef?: React.RefObject<HTMLDivElement | null>
    noWrapper?: boolean
    darkMode?: boolean
    onEditorReady?: (editor: Editor) => void
    onCommentClick?: (commentId: string) => void
  } & React.RefAttributes<TiptapEditorHandle>
>

interface ArticleEditorDocumentProps {
  editor: ArticleEditorController
  editorRef: ArticleEditorRefs['editorRef']
  excerptDomRef: ArticleEditorRefs['excerptDomRef']
  titleDomRef: ArticleEditorRefs['titleDomRef']
  toolbarPortalRef: ArticleEditorRefs['toolbarPortalRef']
  onEditorReady?: (editor: Editor) => void
  onCommentClick?: (commentId: string) => void
}

export function ArticleEditorDocument({ editor, editorRef, excerptDomRef, titleDomRef, toolbarPortalRef, onEditorReady, onCommentClick }: ArticleEditorDocumentProps) {
  const { actions } = editor

  // Bug 4: Dedicated cover-image file input for the document-body button.
  // The shared coverFileRef lives inside ArticleEditorMetadataPanel (sidebar /
  // mobile drawer); calling it from a different component tree can fail in
  // certain browsers when that element is visually off-screen or inside an
  // overflow-hidden ancestor.  Having a local input here gives us a reliable,
  // always-reachable DOM element for the "Add cover image" body button.
  const docCoverInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex-none w-full max-w-[960px] bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] min-h-[calc(100vh-120px)]">
      {/* Hidden file input for the document-body cover-image button */}
      <input
        ref={docCoverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void actions.handleCoverUpload(e)}
      />

      <div className={`relative group w-full overflow-hidden bg-[var(--bg-subtle)] ${editor.coverImage ? 'h-60' : ''}`}>
        {editor.coverImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={editor.coverImage}
              alt="Cover"
              className="w-full h-full object-contain"
              onError={(event) => { event.currentTarget.style.display = 'none' }}
            />
            {editor.canEdit && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => docCoverInputRef.current?.click()}
                  disabled={editor.uploading}
                  className="flex items-center gap-2 text-white text-xs font-semibold bg-black/50 border border-white/20 px-4 py-2 rounded hover:bg-black/70 transition-colors"
                >
                  <ImagePlus size={13} />
                  {editor.uploading ? 'Uploading...' : 'Change'}
                </button>
                <button
                  type="button"
                  onClick={actions.removeCoverImage}
                  className="flex items-center gap-2 text-white/80 text-xs bg-black/40 border border-white/10 px-3 py-2 rounded hover:bg-black/60 transition-colors"
                >
                  <X size={13} />
                  Remove
                </button>
              </div>
            )}
          </>
        ) : (
          editor.canEdit && (
            <button
              type="button"
              onClick={() => docCoverInputRef.current?.click()}
              disabled={editor.uploading}
              className="w-full py-6 flex items-center justify-center gap-2 text-[var(--fg-faint)] text-sm font-bold hover:text-gold hover:bg-[var(--bg)] transition-colors disabled:opacity-50 tracking-wide"
            >
              <ImagePlus size={16} />
              {editor.uploading ? 'Uploading...' : 'Add cover image'}
            </button>
          )
        )}
      </div>

      <div className="px-6 py-10 sm:px-10 sm:py-12 md:px-16 md:py-16 lg:px-20 xl:px-24">
        <textarea
          ref={titleDomRef}
          value={editor.title}
          onChange={(event) => actions.updateTitle(event.target.value)}
          disabled={!editor.canEdit}
          placeholder="Your headline here..."
          rows={1}
          className="w-full bg-transparent border-none outline-none resize-none text-4xl sm:text-5xl font-serif font-bold leading-tight placeholder:text-[var(--fg-faint)] disabled:opacity-60 overflow-hidden mb-4 text-[var(--fg)]"
        />

        <textarea
          ref={excerptDomRef}
          value={editor.excerpt}
          onChange={(event) => actions.setExcerpt(event.target.value)}
          disabled={!editor.canEdit}
          placeholder="Write a brief summary that draws readers in..."
          rows={2}
          className="w-full bg-transparent border-none outline-none resize-none text-xl italic leading-relaxed placeholder:text-[var(--fg-faint)] disabled:opacity-60 overflow-hidden text-[var(--fg-muted)]"
        />

        <div className="mt-6">
          <TiptapEditor
            ref={editorRef}
            content={editor.content}
            onChange={actions.handleContentChange}
            editable={editor.canEdit}
            saveStatus={editor.saveStatus}
            toolbarPortalRef={toolbarPortalRef}
            noWrapper
            darkMode={editor.isDark}
            onEditorReady={onEditorReady}
            onCommentClick={onCommentClick}
          />
        </div>
      </div>
    </div>
  )
}
