'use client'

import { useRef, useState } from 'react'
import { Image as ImageIcon, Quote, Minus, BarChart2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { TiptapEditorHandle } from './TiptapEditor'

interface BlockDef {
  id: string
  label: string
  icon: React.ReactNode
  description: string
  insert: (handle: TiptapEditorHandle) => void
}

const BLOCKS: BlockDef[] = [
  {
    id: 'image',
    label: 'Image',
    icon: <ImageIcon size={18} />,
    description: 'Upload an image',
    insert: (handle) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) handle.uploadImageFile(file)
      }
      input.click()
    },
  },
  {
    id: 'pullquote',
    label: 'Pull Quote',
    icon: <Quote size={18} />,
    description: 'Highlight a key quote',
    insert: (handle) => {
      const editor = handle.getEditor()
      if (!editor) return
      editor.chain().focus().togglePullQuote().run()
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    icon: <Minus size={18} />,
    description: 'Section break',
    insert: (handle) => {
      const editor = handle.getEditor()
      if (!editor) return
      editor.chain().focus().setHorizontalRule().run()
    },
  },
  {
    id: 'chart',
    label: 'Data Callout',
    icon: <BarChart2 size={18} />,
    description: 'Insert a data callout',
    insert: (handle) => {
      const editor = handle.getEditor()
      if (!editor) return
      editor.chain().focus().insertChart({
        chartType: 'bar',
        labels: '["Metric"]',
        datasets: '[{"label":"Value","data":[0]}]',
        title: 'Data Callout',
      }).run()
    },
  },
]

interface Props {
  editorRef: React.RefObject<TiptapEditorHandle | null>
}

export function BlockSidebar({ editorRef }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const dragId = useRef<string | null>(null)

  const handleDragStart = (id: string) => (e: React.DragEvent) => {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'copy'
    // Use custom MIME type so Tiptap does not interpret this as a text drop
    e.dataTransfer.setData('application/x-consilium-block', id)
  }

  const handleClick = (block: BlockDef) => {
    if (!editorRef.current) return
    block.insert(editorRef.current)
  }

  return (
    <div
      className={`flex-shrink-0 flex flex-col transition-all duration-200 ${
        collapsed ? 'w-8' : 'w-44'
      }`}
      style={{ minHeight: 0 }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-center h-8 w-full bg-navy/80 border border-gold/20 text-gold/60 hover:text-gold transition-colors text-xs mb-2 shrink-0"
        aria-label={collapsed ? 'Expand blocks panel' : 'Collapse blocks panel'}
      >
        {collapsed ? <ChevronLeft size={14} /> : (
          <span className="flex items-center gap-1 w-full px-2">
            <ChevronRight size={14} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gold/70">Blocks</span>
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-2">
          {BLOCKS.map((block) => (
            <div
              key={block.id}
              draggable
              onDragStart={handleDragStart(block.id)}
              onClick={() => handleClick(block)}
              className="flex flex-col items-center gap-1.5 p-3 bg-[var(--bg-elevated)] border border-[var(--border)] cursor-pointer hover:border-gold/50 hover:bg-gold/5 transition-all select-none group"
              title={block.description}
            >
              <span className="text-gold/60 group-hover:text-gold transition-colors">
                {block.icon}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)] group-hover:text-[var(--fg-muted)] transition-colors text-center leading-tight">
                {block.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
