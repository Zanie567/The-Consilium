/** Browser-safe topic identity; stored legacy URLs are never recomputed. */
export function canonicalTagSlug(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/i\u0307/g, 'i')
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}
export function topicDisplayName(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/**
 * Most tags one article may carry. The editor and both article-save routes read this one constant;
 * it used to be 10 in the editor and 25 on the server. An article saved before the limit with more
 * tags may keep them (the server refuses only an increase beyond it), so no article loses a topic.
 */
export const MAX_ARTICLE_TAGS = 10

/** What the editor recommends: a few precise topics read better than a long list. */
export const RECOMMENDED_ARTICLE_TAGS = { min: 1, max: 3 } as const
