import { describe, expect, it } from 'vitest'
import { MAX_ARTICLE_TAGS, normalizeArticleTags } from '@/lib/articleTags'

describe('normalizeArticleTags', () => {
  it('keeps valid tags, with their display name and slug', () => {
    expect(normalizeArticleTags(['Monetary Policy', 'Trade'])).toEqual([
      { name: 'Monetary Policy', slug: 'monetary-policy' },
      { name: 'Trade', slug: 'trade' },
    ])
  })

  it('drops non-strings, blanks, and anything that slugs to nothing', () => {
    expect(normalizeArticleTags(['ok', 42, null, '', '   ', '!!!', {}])).toEqual([
      { name: 'ok', slug: 'ok' },
    ])
  })

  it('collapses tags that differ only by case or spacing', () => {
    expect(normalizeArticleTags(['Trade', 'trade', 'TRADE'])).toEqual([
      { name: 'Trade', slug: 'trade' },
    ])
  })

  it('caps the list, so the save transaction cannot be prolonged indefinitely', () => {
    const many = Array.from({ length: MAX_ARTICLE_TAGS + 40 }, (_, i) => `tag-${i}`)
    const result = normalizeArticleTags(many)
    expect(result).toHaveLength(MAX_ARTICLE_TAGS)
    // The cap keeps the earliest tags rather than an arbitrary slice.
    expect(result[0]).toEqual({ name: 'tag-0', slug: 'tag-0' })
  })

  it('treats a non-array as no tags at all', () => {
    expect(normalizeArticleTags(undefined)).toEqual([])
    expect(normalizeArticleTags(null)).toEqual([])
    expect(normalizeArticleTags('trade')).toEqual([])
  })

  it('strips markup rather than storing it as a tag name', () => {
    expect(normalizeArticleTags(['<b>Trade</b>'])).toEqual([{ name: 'Trade', slug: 'trade' }])
  })
})
