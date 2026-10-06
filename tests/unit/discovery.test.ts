import { describe, expect, it } from 'vitest'
import { canonicalTagSlug, normalizeArticleTags } from '@/lib/articleTags'
import { buildArchiveHref, normaliseTagSlugs } from '@/lib/archivePagination'
import { discoveryWhere, DISCOVERY_ARTICLE_SELECT } from '@/lib/discoveryQueries'

describe('canonical topics and discovery', () => {
  it.each([
    ['Investment & Finance', 'investment-finance'],
    [' International  Relations ', 'international-relations'],
    ['--Finance!!', 'finance'],
    ['Ｆｉｎａｎｃｅ', 'finance'],
    ['Café economics', 'café-economics'],
  ])('canonicalises %s', (name, slug) => expect(canonicalTagSlug(name)).toBe(slug))
  it('deduplicates punctuation, case, whitespace and slugs while preserving display text', () => {
    expect(
      normalizeArticleTags(['Investment & Finance', ' investment-finance ', 'INVESTMENT  FINANCE'])
    ).toEqual([{ name: 'Investment & Finance', slug: 'investment-finance' }])
  })
  it('sorts, deduplicates and bounds selected slugs', () => {
    expect(normaliseTagSlugs(['politics', 'history', 'politics', ''])).toEqual([
      'history',
      'politics',
    ])
    expect(normaliseTagSlugs(Array.from({ length: 100 }, (_, i) => `tag-${i}`))).toHaveLength(20)
  })
  it('preserves repeated filters through pagination and refresh', () => {
    expect(buildArchiveHref(2, 'bank', 'analysis', ['politics', 'history'])).toBe(
      '/archive?q=bank&category=analysis&tag=history&tag=politics&page=2'
    )
  })
  it('uses format AND topic OR, with published/not deleted constraints', () => {
    expect(discoveryWhere(undefined, 'analysis', ['history', 'politics'])).toEqual({
      status: 'PUBLISHED',
      deletedAt: null,
      category: { slug: 'analysis' },
      tags: { some: { tag: { slug: { in: ['history', 'politics'] } } } },
    })
  })
  it('searches author/topic without selecting article bodies or private author fields', () => {
    expect(discoveryWhere('100%').OR).toHaveLength(4)
    expect(DISCOVERY_ARTICLE_SELECT).not.toHaveProperty('content')
    expect(DISCOVERY_ARTICLE_SELECT.author.select).not.toHaveProperty('email')
  })
})

describe('Unicode canonical case folding', () => {
  it('keeps Turkish dotted I and Greek final sigma consistent with PostgreSQL identity', () => {
    expect(canonicalTagSlug('İnflation')).toBe(canonicalTagSlug('INFLATION'))
    expect(canonicalTagSlug('ΟΣ')).toBe(canonicalTagSlug('οσ'))
  })
})
