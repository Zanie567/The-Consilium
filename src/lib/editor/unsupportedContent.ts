import type { Schema } from '@tiptap/pm/model'

/**
 * Node and mark types in stored Tiptap JSON that the editor's schema does not know.
 *
 * Tiptap's fallback for JSON it cannot parse is an EMPTY document. Opened in an
 * editor that lacks a node type (for example an equation, in a browser tab still
 * running an older editor bundle), an article would appear blank and the next
 * keystroke would autosave over it. The editor uses this check to stop editing
 * instead. Structural problems that Tiptap repairs without losing content are not
 * reported here, so existing articles open exactly as before.
 */
export function unsupportedContentTypes(content: unknown, schema: Schema): string[] {
  const found = new Set<string>()
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 200) return
    const n = node as { type?: unknown; content?: unknown; marks?: unknown }
    if (typeof n.type === 'string' && !schema.nodes[n.type]) found.add(n.type)
    if (Array.isArray(n.marks)) {
      for (const mark of n.marks) {
        const type = (mark as { type?: unknown } | null)?.type
        if (typeof type === 'string' && !schema.marks[type]) found.add(type)
      }
    }
    if (Array.isArray(n.content)) for (const child of n.content) visit(child, depth + 1)
  }
  visit(content, 0)
  return [...found]
}
