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
  Minus, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Undo, Redo, ChevronDown, List, ListOrdered, Quote, Code2,
  Star, Printer, Type, Highlighter, Table as TableIcon,
  Indent, Outdent,
} from 'lucide-react'
import React, {
  useCallback, useRef, useState, useEffect, useImperativeHandle,
  forwardRef, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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
  toolbarPortalRef?: React.RefObject<HTMLDivElement | null>
  onEditorReady?: (editor: Editor) => void
  noWrapper?: boolean
  darkMode?: boolean
}

// Google Docs 10x10 colour palette (row-major order)
const GOOGLE_DOCS_COLORS: string[] = [
  // Row 1: Greyscale
  '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#efefef','#f3f3f3','#ffffff',
  // Row 2: Pure saturated
  '#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff','#ff0066',
  // Row 3: Dark shades
  '#980000','#c43d00','#cb8400','#2d6a0a','#00575f','#1a53a3','#0d0080','#6a0080','#9c0070','#b3003b',
  // Row 4
  '#cc0000','#e67300','#e6a817','#428f0a','#006b7a','#2170cb','#3333cc','#7b00b3','#b3007a','#cc0044',
  // Row 5: Medium dark
  '#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6fa8dc','#6666cc','#a64d99','#cc4488','#e06688',
  // Row 6: Medium
  '#ea9999','#f9cb9c','#ffe599','#b6d7a8','#a2c4c9','#9fc5e8','#9999cc','#c2a0c2','#d5a6bd','#ea9999',
  // Row 7: Light
  '#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3','#cfe2f3','#d9d2e9','#ead1dc','#f0d9f5','#f4ccd8',
  // Row 8: Very light
  '#fce5e5','#fef0de','#fefce6','#eaf7e2','#e4f2f5','#e8f0fc','#ede7f6','#f5e0ec','#f8f0fe','#fce5f0',
  // Row 9: Pale
  '#fff0f0','#fff5e5','#fdfde8','#f3fbef','#eef8fb','#f5f9ff','#f0f0ff','#f8f0ff','#fdf0f8','#fff0f5',
  // Row 10: Almost white
  '#fff8f8','#fffaf5','#fefef5','#f8fbf5','#f5fcfd','#f8faff','#f8f8ff','#fbf8ff','#fdf8fb','#fff8fb',
]

const FONT_SIZES = ['10','11','12','14','16','18','20','24','28','32','36','48','60','72']

// ── Main component ────────────────────────────────────────────────────────────
export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditor({ content, onChange, editable = true, saveStatus, toolbarPortalRef, onEditorReady, noWrapper, darkMode }, ref) {
    const fileInputRef      = useRef<HTMLInputElement>(null)
    const linkInputRef      = useRef<HTMLInputElement>(null)
    const fontSizeRef       = useRef<HTMLInputElement>(null)
    const headingRef        = useRef<HTMLDivElement>(null)
    const colorPickerRef    = useRef<HTMLDivElement>(null)
    const highlightRef      = useRef<HTMLDivElement>(null)
    const tablePickerRef    = useRef<HTMLDivElement>(null)
    const lineSpacingRef    = useRef<HTMLDivElement>(null)

    const [linkBarOpen,        setLinkBarOpen]        = useState(false)
    const [linkUrl,            setLinkUrl]            = useState('')
    const [uploadError,        setUploadError]        = useState('')
    const [uploading,          setUploading]          = useState(false)
    const [headingOpen,        setHeadingOpen]        = useState(false)
    const [colorOpen,          setColorOpen]          = useState(false)
    const [highlightOpen,      setHighlightOpen]      = useState(false)
    const [tableOpen,          setTableOpen]          = useState(false)
    const [lineSpacingOpen,    setLineSpacingOpen]    = useState(false)
    const [tableHover,         setTableHover]         = useState({ r: 0, c: 0 })
    const [fontSizeInput,      setFontSizeInput]      = useState('16')
    const [activeColor,        setActiveColor]        = useState<string | null>(null)
    const [activeHighlight,    setActiveHighlight]    = useState<string | null>(null)

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
      },
      onSelectionUpdate: ({ editor: ed }) => {
        // TipTap 3: FontSize lives in textStyle.fontSize
        const tsAttrs = ed.getAttributes('textStyle')
        const rawSize: string = tsAttrs.fontSize ?? ''
        const sz = rawSize ? parseInt(rawSize, 10).toString() : '16'
        setFontSizeInput(sz)
        setActiveColor(tsAttrs.color ?? null)
        setActiveHighlight(ed.getAttributes('highlight').color ?? null)
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

    // Notify parent when editor is ready
    useEffect(() => {
      if (editor && onEditorReady) onEditorReady(editor)
    }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

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
        if (lineSpacingRef.current && !lineSpacingRef.current.contains(target)) setLineSpacingOpen(false)
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

    const applyFontSize = useCallback((size: string) => {
      if (!editor) return
      const n = parseInt(size, 10)
      if (!isNaN(n) && n > 0) {
        // TipTap 3's FontSize extension adds setFontSize to the chain
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(editor.chain().focus() as any).setFontSize(`${n}px`).run()
        setFontSizeInput(String(n))
      }
    }, [editor])

    const changeFontSize = useCallback((delta: number) => {
      const cur = parseInt(fontSizeInput, 10) || 16
      applyFontSize(String(Math.max(6, Math.min(96, cur + delta))))
    }, [fontSizeInput, applyFontSize])

    const applyLineSpacing = useCallback((spacing: string) => {
      // Apply line height via textStyle attributes or a paragraph style
      // TipTap doesn't have native line-spacing, we use CSS via a class
      if (!editor) return
      // We toggle a class on selected paragraphs via the DOM extension approach
      // Simplest workaround: apply via paragraph attrs if supported, else noop
      setLineSpacingOpen(false)
    }, [editor])

    if (!editor) return null

    // Current text style for dropdown
    const getHeadingLabel = () => {
      if (editor.isActive('heading', { level: 1 })) return 'Heading 1'
      if (editor.isActive('heading', { level: 2 })) return 'Heading 2'
      if (editor.isActive('heading', { level: 3 })) return 'Heading 3'
      if (editor.isActive('heading', { level: 4 })) return 'Heading 4'
      if (editor.isActive('blockquote'))           return 'Block Quote'
      if (editor.isActive('codeBlock'))            return 'Code Block'
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
        className={`p-1.5 rounded transition-all min-w-[28px] h-7 flex items-center justify-center ${
          active
            ? darkMode ? 'bg-white/15 text-white' : 'bg-[#1a2744]/10 text-[#1a2744] dark:bg-gold/20 dark:text-gold'
            : darkMode ? 'text-white/70 hover:bg-white/8' : 'text-[#444] dark:text-[var(--fg-muted)] hover:bg-black/8 dark:hover:bg-white/10'
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
          <div className="editor-toolbar-bg border-b border-black/10 dark:border-white/10 px-3 py-2 flex items-center gap-2">
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
          <BubbleMenu
            editor={editor}
            shouldShow={({ editor: ed }) => !ed.isActive('table')}
          >
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

        {editable && (
          <BubbleMenu
            editor={editor}
            pluginKey="tableControls"
            shouldShow={({ editor: ed }) => ed.isActive('table')}
            options={{ placement: 'top-start', offset: 8 }}
          >
            <div className={`flex items-center gap-0.5 border shadow-xl px-1.5 py-1 rounded text-[11px] font-medium ${darkMode ? 'bg-[#242424] border-white/15 text-white/80' : 'bg-white border-black/10 text-[#444]'}`}>
              <span className={`text-[9px] uppercase tracking-widest mr-1 ${darkMode ? 'text-white/30' : 'text-[#aaa]'}`}>Table</span>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowBefore().run() }} className={`px-1.5 py-0.5 rounded ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Add row above">+row above</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run() }} className={`px-1.5 py-0.5 rounded ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Add row below">+row below</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnBefore().run() }} className={`px-1.5 py-0.5 rounded ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Add column left">+col left</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run() }} className={`px-1.5 py-0.5 rounded ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Add column right">+col right</button>
              <span className="w-px h-3 bg-current opacity-20 mx-0.5" />
              <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run() }} className="px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete row">-row</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run() }} className="px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete column">-col</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run() }} className="px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete table">del table</button>
            </div>
          </BubbleMenu>
        )}

        {/* ── Toolbar ────────────────────────────────────────────────────────── */}
        {editable && (() => {
          const toolbarContent = (
            <div className="editor-toolbar-bg border-b border-black/10 dark:border-white/10 px-2 py-1 flex flex-wrap gap-0.5 items-center w-full h-full overflow-x-auto">

            {/* Group 1: History */}
            <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
              <Undo size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Shift+Z)">
              <Redo size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => window.print()} title="Print">
              <Printer size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 2: Text style dropdown */}
            <div className="relative" ref={headingRef}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setHeadingOpen((o) => !o) }}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[#444] dark:text-[var(--fg-muted)] hover:bg-black/8 dark:hover:bg-white/10 transition-colors min-w-[110px] h-7"
                title="Text style"
              >
                <span className="flex-1 text-left truncate">{headingLabel}</span>
                <ChevronDown size={11} className={`shrink-0 transition-transform ${headingOpen ? 'rotate-180' : ''}`} />
              </button>

              {headingOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-[var(--bg-elevated)] border border-black/10 dark:border-white/10 shadow-xl z-50 min-w-[160px] rounded overflow-hidden">
                  {[
                    { label: 'Normal text', action: () => editor.chain().focus().setParagraph().run(), isActive: !editor.isActive('heading') && !editor.isActive('blockquote') && !editor.isActive('codeBlock'), size: '1rem' },
                    { label: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: editor.isActive('heading', { level: 1 }), size: '1.6rem', weight: 700 },
                    { label: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: editor.isActive('heading', { level: 2 }), size: '1.3rem', weight: 700 },
                    { label: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: editor.isActive('heading', { level: 3 }), size: '1.1rem', weight: 700 },
                    { label: 'Heading 4', action: () => editor.chain().focus().toggleHeading({ level: 4 }).run(), isActive: editor.isActive('heading', { level: 4 }), size: '1rem', weight: 700 },
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

            {/* Group 3: Font name */}
            <div className="px-2 py-1 text-xs text-[#666] dark:text-[var(--fg-faint)] select-none h-7 flex items-center" title="Font">
              Playfair
            </div>

            <Sep />

            {/* Group 4: Font size */}
            <ToolbarBtn onClick={() => changeFontSize(-1)} title="Decrease font size">
              <span className="text-xs font-bold leading-none">A-</span>
            </ToolbarBtn>
            <input
              ref={fontSizeRef}
              type="number"
              value={fontSizeInput}
              onChange={(e) => setFontSizeInput(e.target.value)}
              onBlur={(e) => applyFontSize(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyFontSize(fontSizeInput) } }}
              min={6}
              max={96}
              className="w-10 h-7 text-center text-xs border border-black/15 dark:border-white/15 bg-transparent rounded focus:outline-none focus:border-[#1a2744] dark:focus:border-gold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              title="Font size"
            />
            <ToolbarBtn onClick={() => changeFontSize(1)} title="Increase font size">
              <span className="text-xs font-bold leading-none">A+</span>
            </ToolbarBtn>

            <Sep />

            {/* Group 5: Text formatting */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
              <Bold size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
              <Italic size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
              <UnderlineIcon size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
              <Strikethrough size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 6: Text color */}
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
                <div className={`absolute left-0 top-full mt-1 border shadow-xl z-50 p-2 rounded ${darkMode ? 'bg-[#242424] border-white/15' : 'bg-white border-black/10'}`}>
                  <p className={`text-[10px] mb-2 uppercase tracking-wider ${darkMode ? 'text-white/40' : 'text-[#666]'}`}>Text colour</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 16px)', gap: 2 }}>
                    {GOOGLE_DOCS_COLORS.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        title={c}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          editor.chain().focus().setColor(c).run()
                          setActiveColor(c)
                          setColorOpen(false)
                        }}
                        className="rounded-full border border-black/10 hover:scale-110 transition-transform"
                        style={{ width: 16, height: 16, background: c, flexShrink: 0 }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className={`text-[10px] ${darkMode ? 'text-white/40' : 'text-[#888]'}`}>#</span>
                    <input
                      type="text"
                      placeholder="hex"
                      maxLength={7}
                      className={`w-16 text-xs border rounded px-1 py-0.5 outline-none ${darkMode ? 'bg-[#333] border-white/15 text-white placeholder:text-white/30' : 'bg-white border-black/15 text-[#333]'}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value
                          const hex = val.startsWith('#') ? val : `#${val}`
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                            editor.chain().focus().setColor(hex).run()
                            setActiveColor(hex)
                            setColorOpen(false)
                          }
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      editor.chain().focus().unsetColor().run()
                      setActiveColor(null)
                      setColorOpen(false)
                    }}
                    className={`mt-1 text-[10px] hover:opacity-70 transition-opacity px-1 ${darkMode ? 'text-white/50' : 'text-[#666]'}`}
                  >
                    Remove colour
                  </button>
                </div>
              )}
            </div>

            {/* Highlight color */}
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
                <div className={`absolute left-0 top-full mt-1 border shadow-xl z-50 p-2 rounded ${darkMode ? 'bg-[#242424] border-white/15' : 'bg-white border-black/10'}`}>
                  <p className={`text-[10px] mb-2 uppercase tracking-wider ${darkMode ? 'text-white/40' : 'text-[#666]'}`}>Highlight</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 16px)', gap: 2 }}>
                    {GOOGLE_DOCS_COLORS.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        title={c}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          editor.chain().focus().toggleHighlight({ color: c }).run()
                          setActiveHighlight(c)
                          setHighlightOpen(false)
                        }}
                        className="rounded-full border border-black/10 hover:scale-110 transition-transform"
                        style={{ width: 16, height: 16, background: c, flexShrink: 0 }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className={`text-[10px] ${darkMode ? 'text-white/40' : 'text-[#888]'}`}>#</span>
                    <input
                      type="text"
                      placeholder="hex"
                      maxLength={7}
                      className={`w-16 text-xs border rounded px-1 py-0.5 outline-none ${darkMode ? 'bg-[#333] border-white/15 text-white placeholder:text-white/30' : 'bg-white border-black/15 text-[#333]'}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value
                          const hex = val.startsWith('#') ? val : `#${val}`
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                            editor.chain().focus().toggleHighlight({ color: hex }).run()
                            setActiveHighlight(hex)
                            setHighlightOpen(false)
                          }
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      editor.chain().focus().unsetHighlight().run()
                      setActiveHighlight(null)
                      setHighlightOpen(false)
                    }}
                    className={`mt-1 text-[10px] hover:opacity-70 transition-opacity px-1 ${darkMode ? 'text-white/50' : 'text-[#666]'}`}
                  >
                    No highlight
                  </button>
                </div>
              )}
            </div>

            <Sep />

            {/* Group 7: Link */}
            <ToolbarBtn onClick={openLinkBar} active={editor.isActive('link')} title="Insert / edit link">
              <Link2 size={15} />
            </ToolbarBtn>
            {editor.isActive('link') && (
              <ToolbarBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">
                <Link2Off size={15} />
              </ToolbarBtn>
            )}

            <Sep />

            {/* Group 8: Insert */}
            {/* Image upload */}
            <ToolbarBtn
              onClick={() => { setTimeout(() => fileInputRef.current?.click(), 0) }}
              title={uploading ? 'Uploading…' : 'Insert image'}
              disabled={uploading}
            >
              {uploading
                ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin block" />
                : <Upload size={15} />}
            </ToolbarBtn>

            {/* Table grid picker */}
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
                  <p className={`text-[10px] mb-2 ${darkMode ? 'text-white/40' : 'text-[#666] dark:text-[var(--fg-faint)]'}`}>
                    {tableHover.r > 0 ? `${tableHover.c} x ${tableHover.r} table` : 'Insert table'}
                  </p>
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(10, 18px)' }}>
                    {Array.from({ length: 80 }).map((_, i) => {
                      const row = Math.floor(i / 10) + 1
                      const col = (i % 10) + 1
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
                          className={`w-[18px] h-[18px] border transition-colors rounded-sm ${
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

            {/* Horizontal rule */}
            <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
              <Minus size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 9: Lists */}
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

            {/* Group 10: Alignment */}
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
              <AlignLeft size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align centre">
              <AlignCenter size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
              <AlignRight size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
              <AlignJustify size={15} />
            </ToolbarBtn>

            <Sep />

            {/* Group 11: Line spacing */}
            <div className="relative" ref={lineSpacingRef}>
              <ToolbarBtn onClick={() => setLineSpacingOpen((o) => !o)} title="Line spacing">
                <span className="text-xs leading-none font-bold">≡</span>
              </ToolbarBtn>
              {lineSpacingOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-[var(--bg-elevated)] border border-black/10 dark:border-white/10 shadow-xl z-50 py-1 rounded min-w-[120px]">
                  {[
                    { label: 'Single (1.0)', value: '1' },
                    { label: '1.15', value: '1.15' },
                    { label: '1.5', value: '1.5' },
                    { label: 'Double (2.0)', value: '2' },
                  ].map(({ label, value }) => (
                    <button
                      key={value}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); applyLineSpacing(value) }}
                      className="w-full text-left px-4 py-2 text-xs text-[#333] dark:text-[var(--fg)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Sep />

            {/* Group 12: Block formats */}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Block quote">
              <Quote size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
              <Code2 size={15} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().togglePullQuote().run()} active={editor.isActive('pullQuote')} title="Pull quote">
              <Star size={15} />
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
          )
          if (toolbarPortalRef?.current) {
            return createPortal(toolbarContent, toolbarPortalRef.current)
          }
          return (
            <div className="editor-toolbar-bg border-b border-black/10 dark:border-white/10 sticky top-0 z-30">
              {toolbarContent}
            </div>
          )
        })()}

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

        {/* ── Document page area ──────────────────────────────────────── */}
        {noWrapper ? (
          <EditorContent
            editor={editor}
            className={`tiptap-editor ${noWrapper ? 'tiptap-no-wrapper' : ''} ${darkMode ? 'editor-dark-mode' : ''} ${!editable ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        ) : (
          <div className="editor-outer min-h-[600px] py-8 px-4">
            <div className="editor-page max-w-[816px] mx-auto">
              <EditorContent
                editor={editor}
                className={`tiptap-editor ${darkMode ? 'editor-dark-mode' : ''} ${!editable ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>
        )}

        {/* ── Status bar ──────────────────────────────────────────────────── */}
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
      </div>
    )
  }
)

function tryParseContent(content: string) {
  try { return JSON.parse(content) } catch { return content }
}
