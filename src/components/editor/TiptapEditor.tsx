'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Node, mergeAttributes, type SingleCommands } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pullQuote: { togglePullQuote: () => ReturnType }
    footnoteRef: { insertFootnote: (content: string) => ReturnType }
    chartNode: { insertChart: (attrs: Record<string, unknown>) => ReturnType }
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
  Bold, Italic, UnderlineIcon, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Link2, Link2Off, Image as ImageIcon,
  Minus, AlignLeft, AlignCenter, AlignRight, Highlighter,
  Undo, Redo, Star, Superscript, BarChart2, Upload, Strikethrough,
} from 'lucide-react'
import { useCallback, useRef } from 'react'

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

// ── Footnote inline node ─────────────────────────────────────────────────────
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

// ── Chart node ───────────────────────────────────────────────────────────────
const ChartNode = Node.create({
  name: 'chartNode',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      chartType: { default: 'bar' },
      labels: { default: '["Category 1","Category 2","Category 3"]' },
      datasets: { default: '[{"label":"Series 1","data":[10,20,30]}]' },
      title: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-chart]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-chart': JSON.stringify({
          type: node.attrs.chartType,
          labels: node.attrs.labels,
          datasets: node.attrs.datasets,
          title: node.attrs.title,
        }),
        class: 'article-chart',
      }),
      `[Chart: ${node.attrs.title || node.attrs.chartType}]`,
    ]
  },
  addCommands() {
    return {
      insertChart: (attrs: Record<string, unknown>) => ({ commands }: { commands: SingleCommands }) => {
        return commands.insertContent({ type: 'chartNode', attrs })
      },
    }
  },
})


// ── Component ────────────────────────────────────────────────────────────────
interface TiptapEditorProps {
  content?: string
  onChange: (content: string) => void
  editable?: boolean
}

export function TiptapEditor({ content, onChange, editable = true }: TiptapEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Begin writing your article...' }),
      CharacterCount,
      PullQuote,
      FootnoteRef,
      ChartNode,
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

  const addLink = useCallback(() => {
    if (!editor) return
    const url = window.prompt('Enter URL')
    if (!url) return
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const addImageFromUrl = useCallback(() => {
    if (!editor) return
    const url = window.prompt('Enter image URL')
    if (!url) return
    editor.chain().focus().setImage({ src: url }).run()
  }, [editor])

  const uploadImage = useCallback(async (file: File) => {
    if (!editor) return
    const form = new FormData()
    form.append('file', file)
    form.append('bucket', 'article-images')
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    if (res.ok) {
      const data = await res.json()
      editor.chain().focus().setImage({ src: data.url }).run()
    }
  }, [editor])

  const insertFootnote = useCallback(() => {
    if (!editor) return
    const text = window.prompt('Footnote text:')
    if (!text) return
    editor.chain().focus().insertFootnote(text).run()
  }, [editor])

  const insertChart = useCallback(() => {
    if (!editor) return
    const title = window.prompt('Chart title:') ?? ''
    const typeInput = window.prompt('Chart type (bar / line):') ?? 'bar'
    const type = ['bar', 'line'].includes(typeInput) ? typeInput : 'bar'
    const labelsRaw = window.prompt('Labels (comma-separated):', 'Jan,Feb,Mar') ?? 'Jan,Feb,Mar'
    const labels = JSON.stringify(labelsRaw.split(',').map((s) => s.trim()))
    const dataRaw = window.prompt('Data (comma-separated numbers):', '10,20,30') ?? '10,20,30'
    const dataArr = dataRaw.split(',').map((s) => Number(s.trim()))
    const datasets = JSON.stringify([{ label: title, data: dataArr }])
    editor.chain().focus().insertChart({ chartType: type, labels, datasets, title }).run()
  }, [editor])

  if (!editor) return null

  // ── Sub-components ────────────────────────────────────────────────────────
  const ToolbarBtn = ({
    onClick, active, title, disabled: dis, children,
  }: {
    onClick: () => void
    active?: boolean
    title: string
    disabled?: boolean
    children: React.ReactNode
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={dis}
      className={`p-1.5 rounded-sm transition-colors ${
        active
          ? 'bg-navy text-gold'
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
      className={`p-1.5 rounded-sm transition-colors text-sm ${
        active ? 'bg-gold/20 text-gold' : 'text-cream/75 hover:text-cream hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )

  const Sep = () => <div className="w-px bg-[var(--border)] mx-1 self-stretch opacity-60" />

  const wordCount = editor.storage.characterCount.words()
  const readingTime = Math.max(1, Math.round(wordCount / 200))

  return (
    <div className="border border-[var(--border)] overflow-hidden">

      {/* ── Bubble menu (appears on text selection) ────────────────────── */}
      {editable && (
        <BubbleMenu editor={editor}>
          <div className="flex items-center gap-0.5 bg-navy border border-gold/20 shadow-2xl px-1.5 py-1">
            <BubbleBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
              <Bold size={13} />
            </BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
              <Italic size={13} />
            </BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
              <UnderlineIcon size={13} />
            </BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
              <Strikethrough size={13} />
            </BubbleBtn>
            <div className="w-px h-4 bg-gold/20 mx-0.5" />
            <BubbleBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
              <Heading2 size={13} />
            </BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
              <Heading3 size={13} />
            </BubbleBtn>
            <div className="w-px h-4 bg-gold/20 mx-0.5" />
            <BubbleBtn onClick={addLink} active={editor.isActive('link')} title="Add link">
              <Link2 size={13} />
            </BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
              <Highlighter size={13} />
            </BubbleBtn>
          </div>
        </BubbleMenu>
      )}

      {/* ── Main toolbar ──────────────────────────────────────────────────── */}
      {editable && (
        <div className="bg-[var(--bg-subtle)] border-b border-[var(--border)] px-2 py-1.5 flex flex-wrap gap-0.5 items-center">
          {/* History */}
          <div className="flex items-center">
            <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo size={14} /></ToolbarBtn>
          </div>
          <Sep />
          {/* Inline formatting */}
          <div className="flex items-center">
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight"><Highlighter size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><Strikethrough size={14} /></ToolbarBtn>
          </div>
          <Sep />
          {/* Headings */}
          <div className="flex items-center">
            <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1"><Heading1 size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={14} /></ToolbarBtn>
          </div>
          <Sep />
          {/* Lists */}
          <div className="flex items-center">
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list"><ListOrdered size={14} /></ToolbarBtn>
          </div>
          <Sep />
          {/* Block elements */}
          <div className="flex items-center">
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Block quote"><Quote size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().togglePullQuote().run()} active={editor.isActive('pullQuote')} title="Pull quote"><Star size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus size={14} /></ToolbarBtn>
          </div>
          <Sep />
          {/* Alignment */}
          <div className="flex items-center">
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left"><AlignLeft size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align centre"><AlignCenter size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right"><AlignRight size={14} /></ToolbarBtn>
          </div>
          <Sep />
          {/* Links & media */}
          <div className="flex items-center">
            <ToolbarBtn onClick={addLink} active={editor.isActive('link')} title="Add link"><Link2 size={14} /></ToolbarBtn>
            {editor.isActive('link') && (
              <ToolbarBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link"><Link2Off size={14} /></ToolbarBtn>
            )}
            <ToolbarBtn onClick={addImageFromUrl} title="Insert image URL"><ImageIcon size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={() => fileInputRef.current?.click()} title="Upload image"><Upload size={14} /></ToolbarBtn>
          </div>
          <Sep />
          {/* Special */}
          <div className="flex items-center">
            <ToolbarBtn onClick={insertFootnote} title="Insert footnote"><Superscript size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={insertChart} title="Insert chart"><BarChart2 size={14} /></ToolbarBtn>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) uploadImage(f)
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
            Select text to format
          </span>
        </div>
      )}
    </div>
  )
}

function tryParseContent(content: string) {
  try { return JSON.parse(content) } catch { return content }
}
