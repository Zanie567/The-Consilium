'use client'

import { Node, mergeAttributes, type RawCommands, type SingleCommands } from '@tiptap/core'
import type { NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { FigureAttributes } from '@/lib/richContent'

// Keep the existing command contract; Figures will add metadata behaviour here.
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: { insertFigure: (attrs: Pick<FigureAttributes, 'src' | 'alt' | 'caption' | 'credit'>) => ReturnType }
  }
}

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
export const FigureNode = Node.create({
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
