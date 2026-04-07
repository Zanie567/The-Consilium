'use client'

import { useEditor, EditorContent, type Editor, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Node, mergeAttributes, type SingleCommands } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pullQuote: { togglePullQuote: () => ReturnType }
    footnoteRef: { insertFootnote: (content: string) => ReturnType }
    figure: { insertFigure: (attrs: { src: string; alt?: string; caption?: string; credit?: string }) => ReturnType }
  }
}
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import {
  Bold, Italic, UnderlineIcon, ChevronDown,
  List, ListOrdered, Quote, Link2, Link2Off, Upload,
  Minus, AlignLeft, AlignCenter, AlignRight,
  Undo, Redo, Star, Strikethrough,
} from 'lucide-react'
import { useCallback, useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import type { NodeViewProps } from '@tiptap/core'

// ── Pull Quote node ─────────────────────────────────────────────────────────
const PullQuote = Node.create({
  name: 'pullQuote',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'aside[data-type="pull-quote"]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-type': 'pull-quote', class: 'pull-quote' }), 0]
  },
  addCommands() {
    return {
      togglePullQuote: () => ({ commands }: { commands: SingleCommands }) => {
        return commands.toggleNode(this.name, 'paragraph')
      },
    }
  },
})

// ── Footnote inline node (kept for backward compatibility with existing articles) ─
const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      index: { default: 1 },
      content: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-footnote': node.attrs.content,
        'data-index': node.attrs.index,
        class: 'footnote-ref',
        title: node.attrs.content,
      }),
      `[${node.attrs.index}]`,
    ]
  },
  addCommands() {
    return {
      insertFootnote: (content: string) => ({ commands, state }: { commands: SingleCommands; state: import('@tiptap/pm/state').EditorState }) => {
        let count = 0
        state.doc.descendants((n) => { if (n.type.name === 'footnoteRef') count++ })
        return commands.insertContent({
          type: 'footnoteRef',
          attrs: { index: count + 1, content },
        })
      },
    }
  },
})

// ── Figure NodeView component ────────────────────────────────────────────────
function FigureNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { src, alt, caption, credit } = node.attrs as {
    src: string; alt: string; caption: string; credit: string
  }
  const isEditable = editor.isEditable

  return (
    <NodeViewWrapper className="article-figure-wrapper my-6" contentEditable={false}>
      <figure
        className={`article-figure ${selected ? 'ring-2 ring-gold/60' : ''}`}
        style={{ margin: 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || ''}
          className="w-full h-auto block rounded-sm"
          style={{ boxShadow: '0 4px 20px rgba(26,39,68,0.08)' }}
        />
        {isEditable ? (
          <>
            <input
              type="text"
              value={caption || ''}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              placeholder="Add a caption…"
              className="figure-caption-input mt-2 block w-full text-center text-sm italic text-[var(--fg-muted)] bg-transparent border-none outline-none placeholder:text-[var(--fg-faint)]/50 focus:placeholder:text-[var(--fg-faint)]"
              onMouseDown={(e) => e.stopPropagation()}
            />
            <input
              type="text"
              value={credit || ''}
              onChange={(e) => updateAttributes({ credit: e.target.value })}
              placeholder="Photo credit (e.g. Jane Smith / Reuters)"
              className="figure-credit-input mt-0.5 block w-full text-center text-xs italic text-[var(--fg-faint)] bg-transparent border-none outline-none placeholder:text-[var(--fg-faint)]/40 focus:placeholder:text-[var(--fg-faint)]"
              onMouseDown={(e) => e.stopPropagation()}
            />
          </>
        ) : (
          <>
            {caption && (
              <figcaption className="mt-2 text-center text-sm italic text-[var(--fg-muted)]">
                {caption}
              </figcaption>
            )}
            {credit && (
              <p className="mt-0.5 text-center text-xs italic text-[var(--fg-faint)]">
                {credit}
              </p>
            )}
          </>
        )}
      </figure>
    </NodeViewWrapper>
  )
}

// ── Figure node ──────────────────────────────────────────────────────────────
const FigureNode = Node.create({
  name: 'figure',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      caption: { default: '' },
      credit: { default: '' },
    }
  },
  parseHTML() {
    return [
      { tag: 'figure.article-figure' },
      // Parse legacy plain images too so old content still works
      { tag: 'img[src]', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src'), alt: (el as HTMLElement).getAttribute('alt') || '' }) },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { class: 'article-figure', 'data-type': 'figure' }),
      ['img', { src: node.attrs.src, alt: node.attrs.alt || '' }],
      ...(node.attrs.caption ? [['figcaption', { class: 'caption' }, node.attrs.caption as string]] : []),
      ...(node.attrs.credit ? [['p', { class: 'image-credit' }, node.attrs.credit as string]] : []),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureNodeView)
  },
  addCommands() {
    return {
      insertFigure: (attrs: { src: string; alt?: string; caption?: string; credit?: string }) => ({ commands }: { commands: SingleCommands }) => {
        return commands.insertContent({ type: 'figure', attrs: { alt: '', caption: '', credit: '', ...attrs } })
      },
    }
  },
})

// ── Public handle exposed to parent via ref ──────────────────────────────────
export interface TiptapEditorHandle {
  getEditor: () => Editor | null
  uploadImageFile: (file: File) => Promise<void>
  insertTextAsContent: (text: string) => void
}

// ── Component ────────────────────────────────────────────────────────────────
interface TiptapEditorProps {
  content?: string
  onChange: (content: string) => void
  editable?: boolean
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditor({ content, onChange, editable = true }, ref) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const linkInputRef = useRef<HTMLInputElement>(null)
    const [linkBarOpen, setLinkBarOpen] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')
    const [uploadError, setUploadError] = useState('')
    const [uploading, setUploading] = useState(false)
    const [headingOpen, setHeadingOpen] = useState(false)
    const headingRef = useRef<HTMLDivElement>(null)

    const editor = useEditor({
      editable,
      extensions: [
        StarterKit,
        Underline,
        Highlight,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        // Keep standard Image for backward compat parsing, but FigureNode handles new inserts
        Image.configure({ inline: false }),
        Link.configure({ openOnClick: false }),
        Placeholder.configure({ placeholder: 'Begin writing your article…' }),
        CharacterCount,
        PullQuote,
        FootnoteRef,
        FigureNode,
      ],
      content: content ? tryParseContent(content) : '',
      onUpdate: ({ editor }) => {
        onChange(JSON.stringify(editor.getJSON()))
      },
      immediatelyRender: false,
      editorProps: {
        transformPastedHTML(html) {
          return html
            .replace(/style="[^"]*"/gi, '')
            .replace(/class="[^"]*"/gi, '')
            .replace(/<span\b[^>]*>/gi, '')
            .replace(/<\/span>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<meta[^>]*>/gi, '')
            .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '<strong>$1</strong>')
            .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '<em>$1</em>')
            .trim()
        },
      },
    })

    // Clear upload error after 4s
    useEffect(() => {
      if (!uploadError) return
      const t = setTimeout(() => setUploadError(''), 4000)
      return () => clearTimeout(t)
    }, [uploadError])

    // Close heading dropdown when clicking outside
    useEffect(() => {
      if (!headingOpen) return
      const handler = (e: MouseEvent) => {
        if (headingRef.current && !headingRef.current.contains(e.target as globalThis.Node)) {
          setHeadingOpen(false)
        }
      }
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }, [headingOpen])

    const uploadImage = useCallback(async (file: File) => {
      if (!editor) return
      setUploading(true)
      setUploadError('')
      try {
        const form = new FormData()
        form.append('file', file)
        form.append('bucket', 'article-images')
        const res = await fetch('/api/upload', { method: 'POST', body: form })
        const data = await res.json()
        if (res.ok) {
          editor.chain().focus().insertFigure({ src: data.url }).run()
        } else {
          setUploadError(data.error ?? 'Upload failed. Check storage is configured.')
        }
      } catch {
        setUploadError('Upload failed. Check your connection and try again.')
      } finally {
        setUploading(false)
      }
    }, [editor])

    // Expose handle to parent (for PDF import)
    useImperativeHandle(ref, () => ({
      getEditor: () => editor ?? null,
      uploadImageFile: uploadImage,
      insertTextAsContent: (text: string) => {
        if (!editor) return
        const paragraphs = text
          .split(/\n{2,}/)
          .map((p) => p.replace(/\n/g, ' ').trim())
          .filter(Boolean)
          .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))
        editor.chain().focus().insertContent({ type: 'doc', content: paragraphs }).run()
      },
    }), [editor, uploadImage])

    const openLinkBar = useCallback(() => {
      if (!editor) return
      const existing = editor.getAttributes('link').href ?? ''
      setLinkUrl(existing)
      setLinkBarOpen(true)
      setTimeout(() => linkInputRef.current?.focus(), 50)
    }, [editor])

    const commitLink = useCallback(() => {
      if (!editor) return
      const url = linkUrl.trim()
      if (url) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      } else {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      }
      setLinkBarOpen(false)
      setLinkUrl('')
    }, [editor, linkUrl])

    if (!editor) return null

    // Current heading level for the dropdown label
    const currentHeadingLevel =
      editor.isActive('heading', { level: 1 }) ? 1 :
      editor.isActive('heading', { level: 2 }) ? 2 :
      editor.isActive('heading', { level: 3 }) ? 3 : 0

    const headingLabel =
      currentHeadingLevel === 1 ? 'Heading 1' :
      currentHeadingLevel === 2 ? 'Heading 2' :
      currentHeadingLevel === 3 ? 'Heading 3' : 'Normal'

    // ── Sub-components ────────────────────────────────────────────────────────
    const ToolbarBtn = ({
      onClick, active, title, disabled: dis, children,
    }: {
      onClick: (e: React.MouseEvent) => void
      active?: boolean
      title: string
      disabled?: boolean
      children: React.ReactNode
    }) => (
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onClick(e) }}
        title={title}
        disabled={dis}
        className={`p-2 rounded-sm transition-all ${
          active
            ? 'bg-navy text-gold shadow-sm'
            : 'text-[var(--fg-muted)] hover:bg-[var(--bg)] hover:text-[var(--fg)]'
        } disabled:opacity-30`}
      >
        {children}
      </button>
    )

    const BubbleBtn = ({
      onClick, active, title, children,
    }: {
      onClick: () => void
      active?: boolean
      title: string
      children: React.ReactNode
    }) => (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`p-1.5 rounded-sm transition-colors ${
          active ? 'bg-gold/20 text-gold' : 'text-cream/75 hover:text-cream hover:bg-white/10'
        }`}
      >
        {children}
      </button>
    )

    const Sep = () => <div className="w-px bg-[var(--border)] mx-0.5 self-stretch opacity-60" />

    const wordCount = editor.storage.characterCount.words()
    const readingTime = Math.max(1, Math.round(wordCount / 200))

    return (
      <div className="border border-[var(--border)]" style={{ isolation: 'isolate' }}>

        {/* Upload error toast */}
        {uploadError && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2.5 text-red-500 text-xs flex items-center gap-2">
            <span className="font-semibold">Upload failed:</span>
            {uploadError}
          </div>
        )}

        {/* Link bar */}
        {linkBarOpen && editable && (
          <div className="bg-[var(--bg-subtle)] border-b border-[var(--border)] px-3 py-2 flex items-center gap-2">
            <Link2 size={13} className="text-[var(--fg-faint)] shrink-0" />
            <input
              ref={linkInputRef}
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitLink() }
                if (e.key === 'Escape') { setLinkBarOpen(false); setLinkUrl('') }
              }}
              placeholder="https://…"
              className="flex-1 bg-transparent text-sm text-[var(--fg)] placeholder:text-[var(--fg-faint)] outline-none border-b border-[var(--border)] focus:border-gold pb-0.5 transition-colors"
            />
            <button type="button" onClick={commitLink} className="text-xs font-bold text-gold hover:text-gold/80 transition-colors px-2">Apply</button>
            <button type="button" onClick={() => { setLinkBarOpen(false); setLinkUrl('') }} className="text-xs text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors">Cancel</button>
          </div>
        )}

        {/* Bubble menu */}
        {editable && (
          <BubbleMenu editor={editor}>
            <div className="flex items-center gap-0.5 bg-navy border border-gold/20 shadow-2xl px-1.5 py-1">
              <BubbleBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold size={13} /></BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic size={13} /></BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={13} /></BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><Strikethrough size={13} /></BubbleBtn>
              <div className="w-px h-4 bg-gold/20 mx-0.5" />
              <BubbleBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">H2</BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">H3</BubbleBtn>
              <div className="w-px h-4 bg-gold/20 mx-0.5" />
              <BubbleBtn onClick={openLinkBar} active={editor.isActive('link')} title="Add link"><Link2 size={13} /></BubbleBtn>
            </div>
          </BubbleMenu>
        )}

        {/* Main toolbar */}
        {editable && (
          <div className="bg-[var(--bg-subtle)] border-b border-[var(--border)] px-2 py-1.5 flex flex-wrap gap-0.5 items-center">

            {/* Undo / Redo */}
            <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)"><Undo size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)"><Redo size={16} /></ToolbarBtn>

            <Sep />

            {/* Heading dropdown */}
            <div className="relative" ref={headingRef}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setHeadingOpen((o) => !o) }}
                className={`flex items-center gap-1 px-2.5 py-2 rounded-sm text-xs font-semibold transition-all ${
                  currentHeadingLevel > 0
                    ? 'bg-navy text-gold'
                    : 'text-[var(--fg-muted)] hover:bg-[var(--bg)] hover:text-[var(--fg)]'
                }`}
                title="Text style"
              >
                <span className="min-w-[64px] text-left">{headingLabel}</span>
                <ChevronDown size={12} className={`transition-transform ${headingOpen ? 'rotate-180' : ''}`} />
              </button>

              {headingOpen && (
                <div className="absolute left-0 top-full mt-1 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg z-50 min-w-[140px]">
                  {[
                    { label: 'Normal text', level: 0 },
                    { label: 'Heading 1', level: 1 },
                    { label: 'Heading 2', level: 2 },
                    { label: 'Heading 3', level: 3 },
                  ].map(({ label, level }) => {
                    const isActive = level === 0 ? !editor.isActive('heading') : editor.isActive('heading', { level })
                    return (
                      <button
                        key={level}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          if (level === 0) {
                            editor.chain().focus().setParagraph().run()
                          } else {
                            editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()
                          }
                          setHeadingOpen(false)
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                          isActive
                            ? 'bg-navy/10 text-navy dark:text-gold font-semibold'
                            : 'text-[var(--fg)] hover:bg-[var(--bg-subtle)]'
                        }`}
                        style={level === 0 ? {} : { fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: level === 1 ? '1.1rem' : level === 2 ? '1rem' : '0.9rem' }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <Sep />

            {/* Inline formatting */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><Strikethrough size={16} /></ToolbarBtn>

            <Sep />

            {/* Lists */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list"><ListOrdered size={16} /></ToolbarBtn>

            <Sep />

            {/* Quote blocks */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Block quote"><Quote size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().togglePullQuote().run()} active={editor.isActive('pullQuote')} title="Pull quote"><Star size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus size={16} /></ToolbarBtn>

            <Sep />

            {/* Alignment */}
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left"><AlignLeft size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align centre"><AlignCenter size={16} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right"><AlignRight size={16} /></ToolbarBtn>

            <Sep />

            {/* Link */}
            <ToolbarBtn onClick={openLinkBar} active={editor.isActive('link')} title="Add link"><Link2 size={16} /></ToolbarBtn>
            {editor.isActive('link') && (
              <ToolbarBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link"><Link2Off size={16} /></ToolbarBtn>
            )}

            {/* Image upload */}
            <ToolbarBtn
              onClick={() => {
                // Small timeout prevents double-fire in some browsers
                setTimeout(() => fileInputRef.current?.click(), 0)
              }}
              title={uploading ? 'Uploading…' : 'Upload image'}
              disabled={uploading}
            >
              {uploading ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin block" />
              ) : (
                <Upload size={16} />
              )}
            </ToolbarBtn>
          </div>
        )}

        {/* Hidden file input for image upload — single instance, never re-mounts */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={false}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadImage(f)
            // Reset so the same file can be re-selected
            e.target.value = ''
          }}
        />

        <EditorContent
          editor={editor}
          className={`tiptap-editor bg-[var(--bg-elevated)] text-[var(--fg)] text-base leading-relaxed ${
            !editable ? 'opacity-70 cursor-not-allowed' : ''
          }`}
        />

        {editable && (
          <div className="bg-[var(--bg-subtle)] border-t border-[var(--border)] px-4 py-2 flex items-center justify-between">
            <span className="text-[var(--fg-faint)] text-xs">
              {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
              {wordCount > 0 && (
                <span className="ml-2 opacity-60">{readingTime} min read</span>
              )}
            </span>
            <span className="text-[var(--fg-faint)] text-xs opacity-50 hidden sm:block">
              Select text to format · Cmd/Ctrl+B for bold
            </span>
          </div>
        )}
      </div>
    )
  }
)

function tryParseContent(content: string) {
  try { return JSON.parse(content) } catch { return content }
}
