/**
 * Plain text of a Tiptap/ProseMirror document, for counting words.
 *
 * Sibling text nodes are concatenated without a space: bold, italic or a link starting
 * mid-word splits one word across nodes ("eco" + "nomics"). Every other node (paragraphs,
 * headings, list items, breaks, images) is a word boundary. Attributes such as image alt
 * text, URLs and footnote data are not article text and are never counted.
 */
function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return ' '
  const n = node as { text?: unknown; content?: unknown }
  if (typeof n.text === 'string') return n.text
  if (!Array.isArray(n.content)) return ' '
  return ` ${n.content.map(extractText).join('')} `
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * The one word count used for every reading-time label and editorial word count.
 * Stored bodies are Tiptap JSON; anything else (legacy HTML or plain text) has its tags removed.
 */
export function wordCountFromContent(content: string): number {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return countWords(content.replace(/<[^>]+>/g, ' '))
  }
  // A bare JSON string or number is plain text, not a document.
  if (!parsed || typeof parsed !== 'object') return countWords(String(content).replace(/<[^>]+>/g, ' '))
  return countWords(extractText(parsed))
}

export function readTimeMinutes(content: string): number {
  return Math.max(1, Math.round(wordCountFromContent(content) / 200))
}

export function readTimeLabel(content: string): string {
  const mins = readTimeMinutes(content)
  return `${mins} min read`
}

