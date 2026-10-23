import type { CSSProperties } from 'react'

/** Stored server-side, per article, without adding a public database column. */
export const coverFramingKey = (articleId: string) => `article_cover_framing_v1:${articleId}`

export type CoverFit = 'contain' | 'cover'
export type CoverBannerHeight = 'compact' | 'standard' | 'tall'

export interface CoverFraming {
  /** Stored for the exact cover URL, so a later image cannot inherit its framing. */
  imageUrl: string
  fit: CoverFit
  zoom: number
  focusX: number
  focusY: number
  height: CoverBannerHeight
}

export const DEFAULT_FRAMING = {
  fit: 'contain',
  zoom: 100,
  focusX: 50,
  focusY: 50,
  height: 'standard',
} as const satisfies Omit<CoverFraming, 'imageUrl'>

export function defaultCoverFraming(imageUrl: string): CoverFraming {
  return { imageUrl, ...DEFAULT_FRAMING }
}

/** Literal class values, so Tailwind retains all variants in the production CSS. */
export const bannerHeightClass: Record<CoverBannerHeight, string> = {
  compact: 'h-[clamp(180px,23vw,360px)]',
  standard: 'h-[clamp(220px,32vw,510px)]',
  tall: 'h-[clamp(240px,42vw,650px)]',
}

/** Untrusted user-controlled settings may be corrupted. Ignore rather than clamp silently. */
export function validateCoverFraming(value: unknown): CoverFraming | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.imageUrl !== 'string' || !v.imageUrl || v.imageUrl.length > 2048) return null
  if (v.fit !== 'contain' && v.fit !== 'cover') return null
  if (v.height !== 'compact' && v.height !== 'standard' && v.height !== 'tall') return null
  for (const k of ['zoom', 'focusX', 'focusY']) {
    if (typeof v[k] !== 'number' || !Number.isInteger(v[k])) return null
  }
  const zoom = v.zoom as number
  const focusX = v.focusX as number
  const focusY = v.focusY as number
  if (zoom < 100 || zoom > 200 || zoom % 5 !== 0 ||
      focusX < 0 || focusX > 100 || focusY < 0 || focusY > 100) return null
  return { imageUrl: v.imageUrl, fit: v.fit, height: v.height, zoom, focusX, focusY }
}

export function parseCoverFraming(raw: string | null | undefined, currentImage: string): CoverFraming {
  if (!raw || !currentImage) return defaultCoverFraming(currentImage)
  try {
    const setting = validateCoverFraming(JSON.parse(raw))
    return setting?.imageUrl === currentImage ? setting : defaultCoverFraming(currentImage)
  } catch {
    return defaultCoverFraming(currentImage)
  }
}

/** Same rendering in the editorial preview and the published article page. */
export function coverFramingImageStyle(frame: CoverFraming): CSSProperties {
  return {
    objectFit: frame.fit,
    objectPosition: `${frame.focusX}% ${frame.focusY}%`,
    transform: `scale(${frame.zoom / 100})`,
    transformOrigin: `${frame.focusX}% ${frame.focusY}%`,
  }
}

/** Keep the existing editorial freeze: an author cannot alter a live/pending article. */
export function writerMayFrameCover(authorId: string, status: string, userId: string): boolean {
  return authorId === userId && (status === 'DRAFT' || status === 'REJECTED')
}
