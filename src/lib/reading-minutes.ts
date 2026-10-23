import { wordCountFromContent } from '@/lib/readTime'

/** Same count as every reading-time label (see readTime.ts). */
export function countWordsInTiptapContent(content: string): number {
  return wordCountFromContent(content)
}

/**
 * Estimate actual reading minutes consumed for one article.
 *
 * @param articleContent  TipTap JSON string stored in Article.content
 * @param avgProgress     Average scroll progress 0-100 from ReadingProgress.progress
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
