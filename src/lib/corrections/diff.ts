/**
 * Passage-level comparison of two versions of an article, for editors reviewing what a correction
 * changes. Articles are stored as TipTap JSON; each top-level block (paragraph, heading, list item,
 * quote, caption) becomes one passage of plain text. The diff is a longest-common-subsequence over
 * passages, which stays small (articles have tens of blocks, not thousands) and shows editors whole
 * sentences in context rather than scattered characters.
 */

export interface PassageChange {
  kind: 'same' | 'removed' | 'added'
  text: string
}

interface Node {
  type?: string
  text?: string
  content?: Node[]
  attrs?: Record<string, unknown>
}

const SPLIT_INTO_CHILDREN = new Set(['bulletList', 'orderedList', 'blockquote', 'table', 'tableRow'])

function textOf(node: Node): string {
  if (typeof node.text === 'string') return node.text
  if (node.type === 'hardBreak') return ' '
  if (node.type === 'footnoteRef' && typeof node.attrs?.content === 'string') return ` [note: ${node.attrs.content}]`
  if (node.type === 'image' || node.type === 'figure') {
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
    const caption = (node.content ?? []).map(textOf).join('')
    return `[image${alt ? `: ${alt}` : ''}]${caption ? ` ${caption}` : ''}`
  }
  return (node.content ?? []).map(textOf).join('')
}

function collect(node: Node, out: string[]): void {
  if (node.type && SPLIT_INTO_CHILDREN.has(node.type)) {
    for (const child of node.content ?? []) collect(child, out)
    return
  }
  const text = textOf(node).replace(/\s+/g, ' ').trim()
  if (text) out.push(text)
}

/** Plain-text passages of an article body (TipTap JSON, or legacy HTML/plain text). */
export function passagesOf(content: string): string[] {
  try {
    const doc = JSON.parse(content) as Node
    if (doc && typeof doc === 'object' && Array.isArray(doc.content)) {
      const out: string[] = []
      for (const block of doc.content) collect(block, out)
      return out
    }
  } catch {
    // not JSON: fall through to markup/plain text
  }
  return content
    .replace(/<\/(p|h[1-6]|li|blockquote|figcaption)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function diffPassages(before: readonly string[], after: readonly string[]): PassageChange[] {
  const n = before.length
  const m = after.length
  // lcs[i][j] = length of the LCS of before[i..] and after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: PassageChange[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: before[i] }); i++; j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: before[i] }); i++
    } else {
      out.push({ kind: 'added', text: after[j] }); j++
    }
  }
  while (i < n) out.push({ kind: 'removed', text: before[i++] })
  while (j < m) out.push({ kind: 'added', text: after[j++] })
  return out
}

export interface TextVersion {
  title: string
  excerpt: string | null
  content: string
  coverImage?: string | null
  authorId?: string
  authorName?: string | null
}

/** Everything that differs between two versions, with one unchanged passage of context either side. */
export function describeTextChanges(before: TextVersion, after: TextVersion) {
  const title = before.title !== after.title ? { before: before.title, after: after.title } : null
  const excerpt = (before.excerpt ?? '').trim() !== (after.excerpt ?? '').trim()
    ? { before: before.excerpt ?? '', after: after.excerpt ?? '' }
    : null
  // Cover image and byline are compared only when the later version states them (older snapshots may not).
  const coverImage = after.coverImage !== undefined && (before.coverImage ?? null) !== (after.coverImage ?? null)
    ? { before: before.coverImage ?? null, after: after.coverImage ?? null }
    : null
  const byline = after.authorId !== undefined && before.authorId !== undefined && before.authorId !== after.authorId
    ? { before: before.authorName ?? before.authorId, after: after.authorName ?? after.authorId }
    : null
  const all = diffPassages(passagesOf(before.content), passagesOf(after.content))
  const keep = new Set<number>()
  all.forEach((change, index) => {
    if (change.kind === 'same') return
    keep.add(index)
    if (all[index - 1]?.kind === 'same') keep.add(index - 1)
    if (all[index + 1]?.kind === 'same') keep.add(index + 1)
  })
  const passages: Array<PassageChange | { kind: 'gap' }> = []
  all.forEach((change, index) => {
    if (keep.has(index)) passages.push(change)
    else if (passages.at(-1)?.kind !== 'gap' && passages.length > 0) passages.push({ kind: 'gap' })
  })
  while (passages.at(-1)?.kind === 'gap') passages.pop()
  const changedPassages = all.filter((c) => c.kind !== 'same').length
  return { title, excerpt, coverImage, byline, passages, changedPassages, changed: Boolean(title || excerpt || coverImage || byline || changedPassages) }
}
