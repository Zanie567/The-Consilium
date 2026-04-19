type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
}

function countWordsInNode(node: TiptapNode): number {
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text.trim().split(/\s+/).filter(Boolean).length
  }
  if (Array.isArray(node.content)) {
    return node.content.reduce((sum, child) => sum + countWordsInNode(child), 0)
  }
  return 0
}

export function countWordsInTiptapContent(content: string): number {
  try {
    const json = JSON.parse(content) as TiptapNode
    return countWordsInNode(json)
  } catch {
    // Plain-text fallback (shouldn't happen in practice)
    return content.split(/\s+/).filter(Boolean).length
  }
}

/**
 * Estimate actual reading minutes consumed for one article.
 *
 * @param articleContent  TipTap JSON string stored in Article.content
 * @param avgProgress     Average scroll progress 0–100 from ReadingProgress.progress
 * @returns               Minutes actually read (word-count / 200 × completion fraction)
 */
export function estimateReadingMinutes(
  articleContent: string,
  avgProgress: number,
): number {
  const wordCount = countWordsInTiptapContent(articleContent)
  const totalMinutes = wordCount / 200
  const fraction = Math.min(1, Math.max(0, avgProgress / 100))
  return totalMinutes * fraction
}
