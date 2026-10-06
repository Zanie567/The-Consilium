'use client'
import { Node, type RawCommands, type SingleCommands } from '@tiptap/core'
import type { NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { useRef, useState } from 'react'
import type { FigureAttributes } from '@/lib/richContent'
import { metadataText, safeContentUrl, safeDimension } from '@/lib/richMetadata'
import { uploadArticleImage, discardArticleImage } from '@/lib/articleImageUpload'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: { insertFigure: (attrs: FigureAttributes) => ReturnType }
  }
}
function FigureNodeView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as FigureAttributes
  const { src, decorative, layout } = attrs
  const alt = decorative ? '' : metadataText(attrs.alt)
  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const sourceUrl = safeContentUrl(attrs.sourceUrl)
  const replace = async (file: File) => {
    if (pending.current) return
    pending.current = true
    setUploading(true)
    setError('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const next = await uploadArticleImage(file, controller.signal)
      if (editor.isDestroyed || controller.signal.aborted) {
        await discardArticleImage(next.url)
        return
      }
      updateAttributes({ src: next.url, width: next.width, height: next.height })
      void discardArticleImage(src)
    } catch {
      setError(
        controller.signal.aborted
          ? 'Replacement cancelled. Your original image is still here.'
          : 'The image could not be replaced. Your original image is still here. Please try again.'
      )
    } finally {
      pending.current = false
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return (
    <NodeViewWrapper className="article-figure-wrapper my-6" contentEditable={false}>
      <figure
        className={`article-figure ${layout === 'centered' ? 'figure-centered' : ''} ${selected ? 'ring-2 ring-gold/60' : ''}`}
        style={{ margin: 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={safeContentUrl(src)}
          alt={alt}
          width={safeDimension(attrs.width)}
          height={safeDimension(attrs.height)}
          className="w-full h-auto block rounded-sm"
        />
        {editor.isEditable ? (
          <div className="figure-fields" onMouseDown={(event) => event.stopPropagation()}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={decorative === true}
                onChange={(e) => updateAttributes({ decorative: e.target.checked })}
              />
              Decorative image (no information conveyed)
            </label>
            {!decorative && (
              <label>
                Alternative text
                <input
                  aria-label="Alternative text"
                  value={attrs.alt ?? ''}
                  maxLength={2000}
                  onChange={(e) => updateAttributes({ alt: e.target.value })}
                  placeholder="Describe the image or chart for readers who cannot see it"
                />
              </label>
            )}
            {!decorative && !alt && (
              <p className="text-amber-600 text-xs">
                Add meaningful alternative text before submitting or publishing.
              </p>
            )}
            {(['caption', 'credit', 'source', 'sourceUrl', 'note'] as const).map((key) => (
              <label key={key}>
                {key === 'sourceUrl' ? 'Source URL' : key[0].toUpperCase() + key.slice(1)}
                <input
                  aria-label={
                    key === 'sourceUrl' ? 'Source URL' : key[0].toUpperCase() + key.slice(1)
                  }
                  type={key === 'sourceUrl' ? 'url' : 'text'}
                  value={attrs[key] ?? ''}
                  maxLength={2000}
                  onChange={(e) => updateAttributes({ [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Figure layout
              <select
                aria-label="Figure layout"
                value={layout ?? 'standard'}
                onChange={(e) => updateAttributes({ layout: e.target.value })}
              >
                <option value="standard">Standard</option>
                <option value="wide">Wide</option>
                <option value="centered">Centred</option>
              </select>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void replace(file)
              }}
            />
            <div className="flex flex-wrap gap-4">
              {uploading && (
                <button type="button" onClick={() => abortRef.current?.abort()}>
                  Cancel replacement
                </button>
              )}
              <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Replacing…' : 'Replace image'}
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  deleteNode()
                  void discardArticleImage(src)
                }}
              >
                Delete figure
              </button>
            </div>
            {error && <p role="alert">{error}</p>}
          </div>
        ) : (
          <>
            {metadataText(attrs.caption) && (
              <figcaption className="caption">{metadataText(attrs.caption)}</figcaption>
            )}
            {(metadataText(attrs.source) || sourceUrl) && (
              <p className="figure-source">
                Source:{' '}
                {sourceUrl ? (
                  <a href={sourceUrl} rel="noopener noreferrer">
                    {metadataText(attrs.source) || sourceUrl}
                  </a>
                ) : (
                  metadataText(attrs.source)
                )}
              </p>
            )}
            {metadataText(attrs.credit) && (
              <p className="image-credit">Credit: {metadataText(attrs.credit)}</p>
            )}
            {metadataText(attrs.note) && (
              <p className="figure-note">Note: {metadataText(attrs.note)}</p>
            )}
          </>
        )}
      </figure>
    </NodeViewWrapper>
  )
}
export const FigureNode = Node.create({
  name: 'figure',
  priority: 110,
  group: 'block',
  atom: true,
  addAttributes() {
    return Object.fromEntries(
      [
        'src',
        'alt',
        'caption',
        'credit',
        'source',
        'sourceUrl',
        'note',
        'decorative',
        'width',
        'height',
        'layout',
      ].map((name) => [
        name,
        {
          default: name === 'decorative' ? false : name === 'layout' ? 'standard' : '',
          parseHTML: (el: HTMLElement) => {
            const image = el.matches('img') ? el : el.querySelector('img')
            if (name === 'src' || name === 'alt') return image?.getAttribute(name) ?? ''
            if (name === 'width' || name === 'height')
              return safeDimension(Number(image?.getAttribute(name)))
            if (name === 'decorative') return el.getAttribute('data-decorative') === 'true'
            return (
              el.getAttribute(`data-${name.toLowerCase()}`) ??
              (name === 'caption' ? el.querySelector('figcaption')?.textContent : '') ??
              ''
            )
          },
          renderHTML: () => ({}),
        },
      ])
    )
  },
  parseHTML() {
    return [{ tag: 'figure.article-figure' }, { tag: 'img[src]' }]
  },
  renderHTML({ node }) {
    const a = node.attrs
    const metadata = Object.fromEntries(
      ['caption', 'credit', 'source', 'sourceUrl', 'note', 'layout']
        .filter((key) => a[key])
        .map((key) => [`data-${key.toLowerCase()}`, metadataText(a[key])])
    )
    return [
      'figure',
      {
        class: 'article-figure',
        'data-type': 'figure',
        ...metadata,
        'data-decorative': a.decorative === true ? 'true' : 'false',
      },
      [
        'img',
        {
          src: safeContentUrl(a.src),
          alt: a.decorative ? '' : metadataText(a.alt),
          width: safeDimension(a.width),
          height: safeDimension(a.height),
        },
      ],
      ...(a.caption ? [['figcaption', { class: 'caption' }, metadataText(a.caption)]] : []),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureNodeView)
  },
  addCommands(): Partial<RawCommands> {
    return {
      insertFigure:
        (attrs) =>
        ({ commands }: { commands: SingleCommands }) =>
          commands.insertContent({ type: 'figure', attrs }),
    }
  },
})
