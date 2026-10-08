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
