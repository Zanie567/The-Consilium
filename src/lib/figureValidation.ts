import { metadataText } from '@/lib/richMetadata'
/** New structured figures require explicit useful alt or decorative semantics. */
export function figureAltError(content: unknown): string | undefined {
  if (typeof content !== 'string') return undefined
  try {
    const doc = JSON.parse(content)
    const walk = (
      node: { type?: string; attrs?: { alt?: unknown; decorative?: unknown }; content?: unknown[] },
      depth: number
    ): boolean => {
      if (depth > 100 || !node || typeof node !== 'object') return false
      if (
        node.type === 'figure' &&
        node.attrs?.decorative !== true &&
        !metadataText(node.attrs?.alt)
      )
        return true
      return (
        Array.isArray(node.content) && node.content.some((n) => walk(n as typeof node, depth + 1))
      )
    }
    if (walk(doc, 0))
      return 'Add meaningful alternative text to each figure, or explicitly mark it decorative, before submitting or publishing.'
  } catch {
    /* Preserve the existing plain-text/legacy content contract. */
  }
}
