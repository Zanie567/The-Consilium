'use client'

import {
  useEditor, EditorContent, type Editor,
  ReactNodeViewRenderer, NodeViewWrapper,
} from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Node, mergeAttributes, type SingleCommands, type RawCommands,
} from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle, Color, FontSize as TipTapFontSize } from '@tiptap/extension-text-style'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import {
  Bold, Italic, UnderlineIcon, Strikethrough, Link2, Link2Off, Upload,
  Minus, AlignLeft, AlignCenter,
  Undo, Redo, ChevronDown, List, ListOrdered, Quote, Code2,
  Type, Highlighter, Table as TableIcon,
  Indent, Outdent,
} from 'lucide-react'
import {
  useCallback, useRef, useState, useEffect, useImperativeHandle,
  forwardRef, type ReactNode,
} from 'react'
import type { NodeViewProps } from '@tiptap/core'

// ── Module augmentations ─────────────────────────────────────────────────────
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pullQuote:  { togglePullQuote: () => ReturnType }
    footnoteRef: { insertFootnote: (content: string) => ReturnType }
    figure:     { insertFigure: (attrs: { src: string; alt?: string; caption?: string; credit?: string }) => ReturnType }
  }
}

// ── Pull Quote node ──────────────────────────────────────────────────────────
const PullQuote = Node.create({
  name: 'pullQuote',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'aside[data-type="pull-quote"]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-type': 'pull-quote', class: 'pull-quote' }), 0]
  },
  addCommands(): Partial<RawCommands> {
    return {
      togglePullQuote: () => ({ commands }: { commands: SingleCommands }) =>
        commands.toggleNode(this.name, 'paragraph'),
    }
  },
})

// ── Footnote inline node ─────────────────────────────────────────────────────
const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      index:   { default: 1 },
      content: { default: '' },
    }
  },
  parseHTML() { return [{ tag: 'sup[data-footnote]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-footnote': node.attrs.content,
        'data-index':    node.attrs.index,
        class:           'footnote-ref',
        title:           node.attrs.content,
      }),
      `[${node.attrs.index}]`,
    ]
  },
  addCommands(): Partial<RawCommands> {
    return {
      insertFootnote: (content: string) => ({
        commands,
        state,
      }: {
        commands: SingleCommands
        state: import('@tiptap/pm/state').EditorState
      }) => {
        let count = 0
        state.doc.descendants((n) => { if (n.type.name === 'footnoteRef') count++ })
        return commands.insertContent({ type: 'footnoteRef', attrs: { index: count + 1, content } })
      },
    }
  },
})

// ── Figure NodeView ──────────────────────────────────────────────────────────
function FigureNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { src, alt, caption, credit } = node.attrs as {
    src: string; alt: string; caption: string; credit: string
  }
  const isEditable = editor.isEditable
  return (
    <NodeViewWrapper className="article-figure-wrapper my-6" contentEditable={false}>
      <figure className={`article-figure ${selected ? 'ring-2 ring-gold/60' : ''}`} style={{ margin: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt || ''} className="w-full h-auto block rounded-sm" style={{ boxShadow: '0 4px 20px rgba(26,39,68,0.08)' }} />
        {isEditable ? (
          <>
            <input type="text" value={caption || ''} onChange={(e) => updateAttributes({ caption: e.target.value })} placeholder="Add a caption…" className="figure-caption-input mt-2 block w-full text-center text-sm italic text-[var(--fg-muted)] bg-transparent border-none outline-none placeholder:text-[var(--fg-faint)]/50" onMouseDown={(e) => e.stopPropagation()} />
            <input type="text" value={credit || ''} onChange={(e) => updateAttributes({ credit: e.target.value })} placeholder="Photo credit (e.g. Jane Smith / Reuters)" className="figure-credit-input mt-0.5 block w-full text-center text-xs italic text-[var(--fg-faint)] bg-transparent border-none outline-none placeholder:text-[var(--fg-faint)]/40" onMouseDown={(e) => e.stopPropagation()} />
          </>
        ) : (
          <>
            {caption && <figcaption className="mt-2 text-center text-sm italic text-[var(--fg-muted)]">{caption}</figcaption>}
            {credit && <p className="mt-0.5 text-center text-xs italic text-[var(--fg-faint)]">{credit}</p>}
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
      src:     { default: null },
      alt:     { default: '' },
      caption: { default: '' },
      credit:  { default: '' },
    }
  },
  parseHTML() {
    return [
      { tag: 'figure.article-figure' },
      { tag: 'img[src]', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src'), alt: (el as HTMLElement).getAttribute('alt') || '' }) },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { class: 'article-figure', 'data-type': 'figure' }),
      ['img', { src: node.attrs.src, alt: node.attrs.alt || '' }],
      ...(node.attrs.caption ? [['figcaption', { class: 'caption' }, node.attrs.caption as string]] : []),
      ...(node.attrs.credit  ? [['p', { class: 'image-credit' }, node.attrs.credit as string]] : []),
    ]
  },
  addNodeView() { return ReactNodeViewRenderer(FigureNodeView) },
  addCommands(): Partial<RawCommands> {
    return {
      insertFigure: (attrs) => ({ commands }: { commands: SingleCommands }) =>
        commands.insertContent({ type: 'figure', attrs: { alt: '', caption: '', credit: '', ...attrs } }),
    }
  },
})

// ── Public handle ────────────────────────────────────────────────────────────
export interface TiptapEditorHandle {
  getEditor: () => Editor | null
  uploadImageFile: (file: File) => Promise<void>
  insertTextAsContent: (text: string) => void
}

// ── Props ────────────────────────────────────────────────────────────────────
interface TiptapEditorProps {
  content?: string
  onChange: (content: string) => void
  editable?: boolean
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
  /** Fix the toolbar to the viewport (used in Google Docs layout). Requires
   *  the consumer to provide the correct top offset via CSS. */
  toolbarFixed?: boolean
  /** Skip the editor-outer/editor-page wrapper and status bar — just render
   *  EditorContent. Use when the parent provides its own document card. */
  contentOnly?: boolean
}

// ── Color palettes ───────────────────────────────────────────────────────────
const TEXT_COLORS = [
  '#000000','#434343','#666666','#999999','#b7b7b7','#d9d9d9','#ffffff',
  '#c00000','#ff0000','#e67c00','#ffff00','#00b050','#00bcd4','#4472c4',
  '#7030a0','#c9a227','#1a2744',
]

const HIGHLIGHT_COLORS = [
  '#ffff00','#ffeb3b','#ffc107','#ff9800','#ff5722',
  '#c8f7c5','#80e5ff','#a9c4ff','#e6b3ff','#ffb3ba',
  '#ffffff',
]

// ── Main component ────────────────────────────────────────────────────────────
export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditor({ content, onChange, editable = true, saveStatus, toolbarFixed = false, contentOnly = false }, ref) {
    const fileInputRef      = useRef<HTMLInputElement>(null)
    const linkInputRef      = useRef<HTMLInputElement>(null)
    const headingRef        = useRef<HTMLDivElement>(null)
    const colorPickerRef    = useRef<HTMLDivElement>(null)
    const highlightRef      = useRef<HTMLDivElement>(null)
    const tablePickerRef    = useRef<HTMLDivElement>(null)

    const [linkBarOpen,     setLinkBarOpen]     = useState(false)
    const [linkUrl,         setLinkUrl]         = useState('')
    const [uploadError,     setUploadError]     = useState('')
    const [uploading,       setUploading]       = useState(false)
    const [headingOpen,     setHeadingOpen]     = useState(false)
    const [colorOpen,       setColorOpen]       = useState(false)
    const [highlightOpen,   setHighlightOpen]   = useState(false)
    const [tableOpen,       setTableOpen]       = useState(false)
    const [tableHover,      setTableHover]      = useState({ r: 0, c: 0 })
    const [activeColor,     setActiveColor]     = useState<string | null>(null)
    const [activeHighlight, setActiveHighlight] = useState<string | null>(null)

    // ── Explicit mark-state tracking so B/I/U buttons reflect cursor position
    // without relying solely on editor.isActive() in the render cycle.
    const [isBold,      setIsBold]      = useState(false)
    const [isItalic,    setIsItalic]    = useState(false)
    const [isUnderline, setIsUnderline] = useState(false)
    const [isStrike,    setIsStrike]    = useState(false)

    const syncMarkState = useCallback((ed: Editor) => {
      setIsBold(ed.isActive('bold'))
      setIsItalic(ed.isActive('italic'))
      setIsUnderline(ed.isActive('underline'))
      setIsStrike(ed.isActive('strike'))
      const tsAttrs = ed.getAttributes('textStyle')
      setActiveColor(tsAttrs.color ?? null)
      setActiveHighlight(ed.getAttributes('highlight').color ?? null)
    }, [])

    const editor = useEditor({
      editable,
      extensions: [
        StarterKit.configure({ codeBlock: { HTMLAttributes: { class: 'code-block' } } }),
        Underline,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Image.configure({ inline: false }),
        Link.configure({ openOnClick: false }),
        Placeholder.configure({ placeholder: 'Begin writing your article…' }),
        CharacterCount,
        TextStyle,
        Color,
        TipTapFontSize,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        PullQuote,
        FootnoteRef,
        FigureNode,
      ],
      content: content ? tryParseContent(content) : '',
      onUpdate: ({ editor: ed }) => {
        onChange(JSON.stringify(ed.getJSON()))
        syncMarkState(ed)
      },
      onSelectionUpdate: ({ editor: ed }) => {
        syncMarkState(ed)
      },
      onTransaction: ({ editor: ed }) => {
        syncMarkState(ed)
      },
      immediatelyRender: false,
      editorProps: {
        transformPastedHTML(html) {
          return html
            .replace(/style="[^"]*"/gi, '')
            .replace(/class="[^"]*"/gi, '')
            .replace(/<span\b[^>]*>/gi, '').replace(/<\/span>/gi, '')
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

    // Close dropdowns when clicking outside
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        const target = e.target as globalThis.Node
        if (headingRef.current    && !headingRef.current.contains(target))    setHeadingOpen(false)
        if (colorPickerRef.current && !colorPickerRef.current.contains(target)) setColorOpen(false)
        if (highlightRef.current  && !highlightRef.current.contains(target))  setHighlightOpen(false)
        if (tablePickerRef.current && !tablePickerRef.current.contains(target)) setTableOpen(false)
      }
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }, [])

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
          setUploadError(data.error ?? 'Upload failed. Check storage configuration.')
        }
      } catch {
        setUploadError('Upload failed. Check your connection and try again.')
      } finally {
        setUploading(false)
      }
    }, [editor])

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

    // Current text style for dropdown
    const getHeadingLabel = () => {
      if (editor.isActive('heading', { level: 2 })) return 'Heading 2'
      if (editor.isActive('heading', { level: 3 })) return 'Heading 3'
      if (editor.isActive('heading', { level: 4 })) return 'Heading 4'
      if (editor.isActive('blockquote'))            return 'Block Quote'
      if (editor.isActive('codeBlock'))             return 'Code Block'
      return 'Normal text'
    }
    const headingLabel = getHeadingLabel()
    const wordCount    = editor.storage.characterCount.words()
    const readingTime  = Math.max(1, Math.round(wordCount / 200))

    // ── Sub-components ───────────────────────────────────────────────────────
    const ToolbarBtn = ({
      onClick, active, title, disabled: dis, children, style,
    }: {
      onClick: (e: React.MouseEvent) => void
      active?: boolean
      title: string
      disabled?: boolean
      children: ReactNode
      style?: React.CSSProperties
    }) => (
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onClick(e) }}
        title={title}
        disabled={dis}
        style={style}
        className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
          active
            ? 'bg-[#e8eaed] text-[#1a1a1a]'
            : 'text-[#444] hover:bg-[#f1f3f4]'
        } disabled:opacity-30`}
      >
        {children}
      </button>
    )

    const BubbleBtn = ({
      onClick, active, title, children,
    }: {
      onClick: () => void; active?: boolean; title: string; children: ReactNode
    }) => (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`p-1.5 rounded transition-colors ${
          active ? 'bg-gold/20 text-gold' : 'text-cream/75 hover:text-cream hover:bg-white/10'
        }`}
      >
        {children}
      </button>
    )

    const Sep = () => (
      <div className="w-px mx-1 self-stretch bg-black/10 dark:bg-white/10" />
    )

    return (
      <div style={{ isolation: 'isolate' }}>

        {/* Upload error */}
        {uploadError && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-red-500 text-xs flex items-center gap-2">
            <span className="font-semibold">Upload failed:</span> {uploadError}
          </div>
        )}

        {/* Link bar */}
        {linkBarOpen && editable && (
          <div className={contentOnly
            ? 'bg-[#f8f9fa] border border-[#e0e0e0] rounded px-3 py-2 mb-3 flex items-center gap-2'
            : 'editor-toolbar-bg border-b border-black/10 dark:border-white/10 px-3 py-2 flex items-center gap-2'
          }>
            <Link2 size={13} className="text-[#777] shrink-0" />
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
              className="flex-1 bg-transparent text-sm text-[var(--fg)] placeholder:text-[#aaa] outline-none border-b border-black/15 focus:border-[#1a2744] pb-0.5 transition-colors"
            />
            <button type="button" onClick={commitLink} className="text-xs font-bold text-[#1a2744] dark:text-gold hover:opacity-70 transition-opacity px-2">Apply</button>
            <button type="button" onClick={() => { setLinkBarOpen(false); setLinkUrl('') }} className="text-xs text-[#777] hover:text-[#333] transition-colors">Cancel</button>
          </div>
        )}

        {/* Bubble menu for selected text */}
        {editable && (
          <BubbleMenu editor={editor}>
            <div className="flex items-center gap-0.5 bg-navy border border-gold/20 shadow-2xl px-1.5 py-1 rounded">
              <BubbleBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold size={13} /></BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic size={13} /></BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={13} /></BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><Strikethrough size={13} /></BubbleBtn>
              <div className="w-px h-4 bg-gold/20 mx-0.5" />
              <BubbleBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><span className="text-xs font-bold">H2</span></BubbleBtn>
              <BubbleBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><span className="text-xs font-bold">H3</span></BubbleBtn>
              <div className="w-px h-4 bg-gold/20 mx-0.5" />
              <BubbleBtn onClick={openLinkBar} active={editor.isActive('link')} title="Add link"><Link2 size={13} /></BubbleBtn>
            </div>
          </BubbleMenu>
        )}

        {/* ── Toolbar ────────────────────────────────────────────────────────── */}
        {editable && (
          <div className={toolbarFixed
            ? 'fixed top-12 left-[220px] right-0 z-[49] bg-white border-b border-[#e0e0e0] px-2 py-1 flex flex-wrap gap-0.5 items-center h-10'
            : 'editor-toolbar-bg border-b border-black/10 dark:border-white/10 px-2 py-1 flex flex-wrap gap-0.5 items-center sticky top-0 z-30'
          }>

            {/* Group 1: History */}
            <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
              <Undo size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Shift+Z)">
              <Redo size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 2: Text style dropdown — Normal / H2 / H3 / H4 */}
            <div className="relative" ref={headingRef}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setHeadingOpen((o) => !o) }}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[#444] hover:bg-[#f1f3f4] transition-colors min-w-[110px] h-7"
                title="Text style"
              >
                <span className="flex-1 text-left truncate">{headingLabel}</span>
                <ChevronDown size={11} className={`shrink-0 transition-transform ${headingOpen ? 'rotate-180' : ''}`} />
              </button>

              {headingOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-[var(--bg-elevated)] border border-black/10 dark:border-white/10 shadow-xl z-50 min-w-[160px] rounded overflow-hidden">
                  {[
                    { label: 'Normal text', action: () => editor.chain().focus().setParagraph().run(), isActive: !editor.isActive('heading') && !editor.isActive('blockquote') && !editor.isActive('codeBlock'), size: '1rem' },
                    { label: 'Heading 2',   action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: editor.isActive('heading', { level: 2 }), size: '1.3rem', weight: 700 },
                    { label: 'Heading 3',   action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: editor.isActive('heading', { level: 3 }), size: '1.1rem', weight: 700 },
                    { label: 'Heading 4',   action: () => editor.chain().focus().toggleHeading({ level: 4 }).run(), isActive: editor.isActive('heading', { level: 4 }), size: '1rem',  weight: 700 },
                  ].map(({ label, action, isActive, size, weight }) => (
                    <button
                      key={label}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); action(); setHeadingOpen(false) }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-[#1a2744]/8 text-[#1a2744] dark:text-gold'
                          : 'text-[#333] dark:text-[var(--fg)] hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                      style={{ fontFamily: weight ? 'var(--font-serif)' : undefined, fontSize: size, fontWeight: weight }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Sep />

            {/* Group 3: Text formatting — B / I / U / S */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()}      active={isBold}      title="Bold (Ctrl+B)">
              <Bold size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()}    active={isItalic}    title="Italic (Ctrl+I)">
              <Italic size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={isUnderline} title="Underline (Ctrl+U)">
              <UnderlineIcon size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()}    active={isStrike}    title="Strikethrough">
              <Strikethrough size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 4: Text colour */}
            <div className="relative" ref={colorPickerRef}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setColorOpen((o) => !o); setHighlightOpen(false) }}
                title="Text colour"
                className="p-1.5 rounded hover:bg-black/8 dark:hover:bg-white/10 transition-colors h-7 flex flex-col items-center justify-center gap-0.5"
              >
                <Type size={13} className="text-[#444] dark:text-[var(--fg-muted)]" />
                <div className="h-1 w-4 rounded-sm" style={{ background: activeColor ?? '#000000' }} />
              </button>
              {colorOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-[var(--bg-elevated)] border border-black/10 dark:border-white/10 shadow-xl z-50 p-2 rounded">
                  <p className="text-[10px] text-[#666] dark:text-[var(--fg-faint)] mb-2 uppercase tracking-wider">Text colour</p>
                  <div className="grid grid-cols-9 gap-1 mb-1">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          editor.chain().focus().setColor(c).run()
                          setActiveColor(c)
                          setColorOpen(false)
                        }}
                        className="w-5 h-5 rounded-sm border border-black/10 hover:scale-110 transition-transform"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      editor.chain().focus().unsetColor().run()
                      setActiveColor(null)
                      setColorOpen(false)
                    }}
                    className="mt-1 text-[10px] text-[#666] dark:text-[var(--fg-faint)] hover:text-[#333] transition-colors px-1"
                  >
                    ✕ Remove colour
                  </button>
                </div>
              )}
            </div>

            {/* Highlight colour */}
            <div className="relative" ref={highlightRef}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setHighlightOpen((o) => !o); setColorOpen(false) }}
                title="Highlight colour"
                className="p-1.5 rounded hover:bg-black/8 dark:hover:bg-white/10 transition-colors h-7 flex flex-col items-center justify-center gap-0.5"
              >
                <Highlighter size={13} className="text-[#444] dark:text-[var(--fg-muted)]" />
                <div className="h-1 w-4 rounded-sm" style={{ background: activeHighlight ?? '#ffff00' }} />
              </button>
              {highlightOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-[var(--bg-elevated)] border border-black/10 dark:border-white/10 shadow-xl z-50 p-2 rounded">
                  <p className="text-[10px] text-[#666] dark:text-[var(--fg-faint)] mb-2 uppercase tracking-wider">Highlight</p>
                  <div className="grid grid-cols-6 gap-1 mb-1">
                    {HIGHLIGHT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          editor.chain().focus().toggleHighlight({ color: c }).run()
                          setActiveHighlight(c)
                          setHighlightOpen(false)
                        }}
                        className="w-6 h-6 rounded-sm border border-black/10 hover:scale-110 transition-transform"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      editor.chain().focus().unsetHighlight().run()
                      setActiveHighlight(null)
                      setHighlightOpen(false)
                    }}
                    className="mt-1 text-[10px] text-[#666] dark:text-[var(--fg-faint)] hover:text-[#333] transition-colors px-1"
                  >
                    ✕ Remove highlight
                  </button>
                </div>
              )}
            </div>

            <Sep />

            {/* Group 5: Link */}
            <ToolbarBtn onClick={openLinkBar} active={editor.isActive('link')} title="Insert / edit link">
              <Link2 size={15} />
            </ToolbarBtn>
            {editor.isActive('link') && (
              <ToolbarBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">
                <Link2Off size={15} />
              </ToolbarBtn>
            )}

            <Sep />

            {/* Group 6: Insert — image, table, HR */}
            <ToolbarBtn
              onClick={() => { setTimeout(() => fileInputRef.current?.click(), 0) }}
              title={uploading ? 'Uploading…' : 'Insert image'}
              disabled={uploading}
            >
              {uploading
                ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin block" />
                : <Upload size={15} />}
            </ToolbarBtn>

            <div className="relative" ref={tablePickerRef}>
              <ToolbarBtn
                onClick={() => { setTableOpen((o) => !o); setColorOpen(false); setHighlightOpen(false) }}
                active={editor.isActive('table')}
                title="Insert table"
              >
                <TableIcon size={15} />
              </ToolbarBtn>
              {tableOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-[var(--bg-elevated)] border border-black/10 dark:border-white/10 shadow-xl z-50 p-2 rounded">
                  <p className="text-[10px] text-[#666] dark:text-[var(--fg-faint)] mb-2">
                    {tableHover.r > 0 ? `${tableHover.r} × ${tableHover.c} table` : 'Insert table'}
                  </p>
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(8, 20px)' }}>
                    {Array.from({ length: 64 }).map((_, i) => {
                      const row = Math.floor(i / 8) + 1
                      const col = (i % 8) + 1
                      const on  = row <= tableHover.r && col <= tableHover.c
                      return (
                        <button
                          key={i}
                          type="button"
                          onMouseEnter={() => setTableHover({ r: row, c: col })}
                          onMouseLeave={() => setTableHover({ r: 0, c: 0 })}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            editor.chain().focus().insertTable({ rows: row, cols: col, withHeaderRow: true }).run()
                            setTableOpen(false)
                            setTableHover({ r: 0, c: 0 })
                          }}
                          className={`w-5 h-5 border transition-colors rounded-sm ${
                            on
                              ? 'bg-[#1a2744]/15 border-[#1a2744]/40 dark:bg-gold/20 dark:border-gold/40'
                              : 'border-black/15 dark:border-white/15 hover:bg-black/5'
                          }`}
                        />
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
              <Minus size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 7: Lists */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
              <List size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
              <ListOrdered size={15} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
              disabled={!editor.can().sinkListItem('listItem')}
              title="Indent (Tab)"
            >
              <Indent size={15} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().liftListItem('listItem').run()}
              disabled={!editor.can().liftListItem('listItem')}
              title="Outdent (Shift+Tab)"
            >
              <Outdent size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 8: Alignment — left and centre only */}
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
              <AlignLeft size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align centre">
              <AlignCenter size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 9: Block formats */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Block quote">
              <Quote size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
              <Code2 size={15} />
            </ToolbarBtn>

            {/* Save status indicator */}
            {saveStatus && saveStatus !== 'idle' && (
              <div className="ml-auto pr-1 flex items-center gap-1.5 text-xs">
                {saveStatus === 'saving' && <span className="text-[#999]">Saving…</span>}
                {saveStatus === 'saved'  && <span className="text-emerald-600 dark:text-emerald-400">Saved</span>}
                {saveStatus === 'error'  && <span className="text-red-500">Save failed</span>}
              </div>
            )}
          </div>
        )}

        {/* ── Single hidden file input ─────────────────────────────────────── */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={false}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadImage(f)
            e.target.value = ''
          }}
        />

        {/* ── Document page area ──────────────────────────────────────────── */}
        {contentOnly ? (
          <EditorContent
            editor={editor}
            className={`tiptap-editor ${!editable ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        ) : (
          <>
            <div className="editor-outer min-h-[600px] py-8 px-4">
              <div className="editor-page max-w-[816px] mx-auto">
                <EditorContent
                  editor={editor}
                  className={`tiptap-editor ${!editable ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>

            {/* ── Status bar ────────────────────────────────────────────── */}
            {editable && (
              <div className="editor-outer border-t border-black/8 dark:border-white/8 px-4 py-1.5 flex items-center justify-between">
                <span className="text-xs text-[#888] dark:text-[var(--fg-faint)]">
                  {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
                  {wordCount > 0 && <span className="ml-2 opacity-60">{readingTime} min read</span>}
                </span>
                <span className="text-[10px] text-[#aaa] dark:text-[var(--fg-faint)] hidden sm:block">
                  Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Ctrl+Z undo
                </span>
              </div>
            )}
          </>
        )}
      </div>
    )
  }
)

function tryParseContent(content: string) {
  try { return JSON.parse(content) } catch { return content }
}
