import type { TiptapNode } from '@/lib/articleRender'

/**
 * Structured extraction of the translatable strings in a TipTap document.
 *
 * Articles are stored as TipTap JSON, not HTML, which removes the whole class
 * of "send markup to a translation provider and hope safe markup comes back"
 * failures. Only leaf strings are ever sent: text-node text, figure captions,
 * credits, alt text and footnote text. Node types, marks, heading levels, link
 * hrefs, image srcs and every other attribute are structurally incapable of
 * being altered, because they are never part of the payload.
 *
 * Extraction and re-injection share ONE traversal. `extractTranslatable` walks
 * a deep clone and, at each translatable leaf, records the current string and a
 * setter closure over that exact position. `rebuild` then writes the provider's
 * strings back through those same closures, in the same order. The two halves
 * cannot drift out of alignment, because there are not two halves.
 */

/** Attributes carrying reader-facing prose, by node type. */
const TRANSLATABLE_ATTRS: Record<string, readonly string[]> = {
  figure: ['caption', 'credit', 'alt'],
  image: ['alt'],
  footnoteRef: ['content'],
}

const BARE_URL_RE = /^(?:https?:\/\/|www\.)\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HAS_LETTER_RE = /\p{L}/u

/**
 * Whether a string is worth sending to the provider.
 *
 * Filters three kinds of payload that cost quota and can only be damaged by
 * translation: strings with no letters at all ("2024", "£1.2bn", "—"), bare
 * URLs, and bare email addresses. A citation footnote that is nothing but a
 * link therefore survives a translated article byte-identical, while a footnote
 * written as prose is translated normally.
 */
export function isTranslatableString(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  if (!HAS_LETTER_RE.test(trimmed)) return false
  if (BARE_URL_RE.test(trimmed)) return false
  if (EMAIL_RE.test(trimmed)) return false
  return true
}

export interface TranslatableDocument {
  /** Strings to translate, in document order. */
  strings: string[]
  /**
   * Returns a new document with `translated` substituted for `strings`.
   * `translated` must have exactly the same length as `strings`.
   */
  rebuild(translated: readonly string[]): TiptapNode
}

type Setter = (value: string) => void

function isNode(value: unknown): value is TiptapNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walk(node: TiptapNode, strings: string[], setters: Setter[]): void {
  if (node.type === 'text' && typeof node.text === 'string') {
    if (isTranslatableString(node.text)) {
      strings.push(node.text)
      setters.push((value) => {
        node.text = value
      })
    }
  }

  const attrNames = TRANSLATABLE_ATTRS[node.type]
  if (attrNames && node.attrs) {
    const attrs = node.attrs
    for (const name of attrNames) {
      const current = attrs[name]
      if (typeof current !== 'string' || !isTranslatableString(current)) continue
      strings.push(current)
      setters.push((value) => {
        attrs[name] = value
      })
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (isNode(child)) walk(child, strings, setters)
    }
  }
}

/**
 * Collects the translatable strings of a document. The input is never mutated:
 * the returned `rebuild` operates on a private deep clone.
 */
export function extractTranslatable(doc: TiptapNode): TranslatableDocument {
  const clone = structuredClone(doc)
  const strings: string[] = []
  const setters: Setter[] = []
  walk(clone, strings, setters)

  return {
    strings,
    rebuild(translated) {
      if (translated.length !== setters.length) {
        throw new Error(
          `translation slot mismatch: expected ${setters.length} strings, received ${translated.length}`
        )
      }
      for (let i = 0; i < setters.length; i++) setters[i](translated[i])
      return clone
    },
  }
}

/**
 * Parses stored article content as a TipTap document, or returns null when it
 * is not one. Non-document content falls back to the renderer's plain-text
 * path, which the translation service handles separately.
 */
export function parseArticleDocument(content: string): TiptapNode | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (isNode(parsed) && parsed.type === 'doc') return parsed
  } catch {}
  return null
}
