export const coverMetadataKey = (articleId: string) => `article_cover_metadata_v1:${articleId}`

export interface CoverImageMetadata {
  /** Exact image URL prevents stale credits being attributed to a replacement. */
  imageUrl: string
  caption: string
  source: string
  sourceUrl: string
}

function httpUrl(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Never trust a stored setting as HTML or attribute content. Display through React only. */
export function validateCoverMetadata(value: unknown): CoverImageMetadata | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const keys = ['imageUrl', 'caption', 'source', 'sourceUrl'] as const
  if (!keys.every((key) => typeof obj[key] === 'string')) return null
  const imageUrl = (obj.imageUrl as string).trim()
  const caption = (obj.caption as string).trim()
  const source = (obj.source as string).trim()
  const sourceUrl = (obj.sourceUrl as string).trim()
  if (!imageUrl || imageUrl.length > 2048 || caption.length > 500 ||
      source.length > 250 || sourceUrl.length > 2048 || !httpUrl(sourceUrl)) return null
  if ((caption || sourceUrl) && !source) return null
  return { imageUrl, caption, source, sourceUrl }
}

export function parseCoverMetadata(raw: string | null | undefined, imageUrl: string | null): CoverImageMetadata | null {
  if (!raw || !imageUrl) return null
  try {
    const metadata = validateCoverMetadata(JSON.parse(raw))
    return metadata?.imageUrl === imageUrl ? metadata : null
  } catch {
    return null
  }
}
