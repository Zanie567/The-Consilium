import { HERO_ROTATION_LIMIT } from '@/lib/heroArticles'

/** Editors can temporarily curate the carousel, but a new publication resets
 * manual curation, guaranteeing newly published reporting reaches the front page. */
export const HOME_CAROUSEL_SETTING_KEY = 'homepage_carousel_v1'

export interface HomeCarouselSetting {
  ids: string[]
  newestId: string
}

export function parseHomeCarouselSetting(value: string | null | undefined): HomeCarouselSetting | null {
  if (!value) return null
  try {
    const raw: unknown = JSON.parse(value)
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    if (typeof record.newestId !== 'string' || !Array.isArray(record.ids)) return null
    if (record.ids.length < 1 || record.ids.length > HERO_ROTATION_LIMIT) return null
    if (!record.ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)) return null
    const ids = record.ids as string[]
    if (new Set(ids).size !== ids.length) return null
    return { ids, newestId: record.newestId }
  } catch {
    return null
  }
}

export function orderHomeCarousel<T extends { id: string }>(
  recent: readonly T[],
  stored: HomeCarouselSetting | null,
  limit: number = HERO_ROTATION_LIMIT,
): T[] {
  const fallback = recent.slice(0, limit)
  if (!recent.length || stored?.newestId !== recent[0].id) return fallback
  const index = new Map(recent.map((article) => [article.id, article]))
  const ordered = stored.ids.map((id) => index.get(id)).filter((article): article is T => Boolean(article))
  if (!ordered.length) return fallback
  const chosen = new Set(ordered.map((article) => article.id))
  return [...ordered, ...recent.filter((article) => !chosen.has(article.id))].slice(0, limit)
}
