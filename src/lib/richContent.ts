/** Shared storage contract: Tiptap JSON serialized into Article.content.
 * These types do not validate untrusted JSON. See docs/platform-upgrade/ARCHITECTURE.md.
 */
export type RichContentAttribute =
  | string
  | number
  | boolean
  | null
  | RichContentAttribute[]
  | { [key: string]: RichContentAttribute }

export interface TiptapMark {
  type: string
  attrs?: Record<string, RichContentAttribute>
}

export interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
  attrs?: Record<string, RichContentAttribute>
}

/** Optional plain-text metadata, except sourceUrl (validated HTTP(S) URL). */
export interface RichBlockMetadata {
  caption?: string
  source?: string
  sourceUrl?: string
  note?: string
}

/** Additive figure attributes; legacy documents may contain only src/alt. */
export interface FigureAttributes extends RichBlockMetadata {
  src: string
  alt?: string
  credit?: string
  decorative?: boolean
  width?: number
  height?: number
  layout?: 'standard' | 'wide' | 'centered'
}

/** Metadata attaches to the native table node, not a neighbouring paragraph. */
export type TableAttributes = RichBlockMetadata

/** Native ProseMirror table-cell attributes; colwidth is an array in saved JSON. */
export interface TableCellAttributes {
  colspan?: number
  rowspan?: number
  colwidth?: number[] | null
}
