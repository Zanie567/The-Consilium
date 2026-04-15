// Recursively extract plain text from a Tiptap/ProseMirror JSON node
function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; content?: unknown[] }
  if (typeof n.text === 'string') return n.text
  if (Array.isArray(n.content)) return n.content.map(extractText).join(' ')
  return ''
}

export function readTimeMinutes(content: string): number {
  try {
    const parsed = JSON.parse(content)
    const text = extractText(parsed).trim()
    const words = text.split(/\s+/).filter(Boolean).length
    return Math.max(1, Math.round(words / 200))
  } catch {
    const words = content.trim().split(/\s+/).filter(Boolean).length
    return Math.max(1, Math.round(words / 200))
  }
}

export function readTimeLabel(content: string): string {
  const mins = readTimeMinutes(content)
  return `${mins} min read`
}

export function wordCountFromContent(content: string): number {
  try {
    const parsed = JSON.parse(content)
    const text = extractText(parsed).trim()
    return text.split(/\s+/).filter(Boolean).length
  } catch {
    return content.trim().split(/\s+/).filter(Boolean).length
  }
}
