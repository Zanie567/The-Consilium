import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARTICLE_LIST_FILTERS,
  filterAndSortArticles,
  filterArticlesIgnoringStatus,
  formatListDate,
  hasActiveFilters,
  isMissingCover,
  matchesQuery,
  sortArticles,
  type ArticleListItem,
} from '@/lib/articleListView'

function item(overrides: Partial<ArticleListItem> & { id: string }): ArticleListItem {
  return {
    title: `Title ${overrides.id}`,
    status: 'DRAFT',
    isFeatured: false,
    isPinned: false,
    updatedAt: '2026-11-01T10:00:00.000Z',
    publishedAt: null,
    scheduledAt: null,
    slug: `slug-${overrides.id}`,
    coverImage: null,
    author: { id: 'u1', name: 'Eleanor Hughes' },
    category: { name: 'Analysis', slug: 'analysis' },
    tags: [],
    ...overrides,
  }
}

const tag = (name: string) => ({ tag: { name, slug: name.toLowerCase().replaceAll(' ', '-') } })
const filters = (change: Partial<typeof DEFAULT_ARTICLE_LIST_FILTERS>) => ({ ...DEFAULT_ARTICLE_LIST_FILTERS, ...change })
const ids = (rows: ArticleListItem[]) => rows.map((r) => r.id)

describe('matchesQuery', () => {
  const article = item({ id: 'a', title: 'Why Sticky Inflation Persists', tags: [tag('Monetary Policy'), tag('Économie')] })

  it('finds an article by title, author, format or tag, ignoring case', () => {
    for (const query of ['sticky', 'ELEANOR', 'analysis', 'monetary policy', '  inflation  ']) {
      expect(matchesQuery(article, query), query).toBe(true)
    }
  })

  it('requires every word, in any order and across fields', () => {
    expect(matchesQuery(article, 'hughes inflation monetary')).toBe(true)
    expect(matchesQuery(article, 'hughes housing')).toBe(false)
  })

  it('ignores accents in both the query and the text', () => {
    expect(matchesQuery(article, 'economie')).toBe(true)
    expect(matchesQuery(item({ id: 'b', title: 'Economie' }), 'économie')).toBe(true)
  })

  it('matches everything for an empty query, and copes with an untitled, untagged draft', () => {
    const bare = item({ id: 'c', title: null, tags: undefined, category: null, author: { id: 'u', name: null } })
    expect(matchesQuery(bare, '')).toBe(true)
    expect(matchesQuery(bare, '   ')).toBe(true)
    expect(matchesQuery(bare, 'anything')).toBe(false)
  })
})

describe('filters', () => {
  const rows = [
    item({ id: 'draft', status: 'DRAFT', category: null }),
    item({ id: 'news', status: 'PUBLISHED', category: { name: 'News', slug: 'news' }, coverImage: 'https://images.unsplash.com/photo-1' }),
    item({ id: 'analysis', status: 'PUBLISHED', coverImage: 'javascript:alert(1)' }),
  ]

  it('filters by format, including "no format"', () => {
    expect(ids(filterArticlesIgnoringStatus(rows, filters({ category: 'news' })))).toEqual(['news'])
    expect(ids(filterArticlesIgnoringStatus(rows, filters({ category: 'none' })))).toEqual(['draft'])
    expect(filterArticlesIgnoringStatus(rows, filters({}))).toHaveLength(3)
  })

  it('"without a cover image" includes a cover value that could never load', () => {
    expect(rows.map(isMissingCover)).toEqual([true, false, true])
    expect(ids(filterArticlesIgnoringStatus(rows, filters({ missingCover: true })))).toEqual(['draft', 'analysis'])
  })

  it('applies the status on top of the other filters', () => {
    expect(ids(filterAndSortArticles(rows, filters({ status: 'PUBLISHED', missingCover: true })))).toEqual(['analysis'])
    expect(filterAndSortArticles(rows, filters({ status: 'ARCHIVED' }))).toEqual([])
  })

  it('knows when nothing is narrowing the list (the sort alone does not count)', () => {
    expect(hasActiveFilters(DEFAULT_ARTICLE_LIST_FILTERS)).toBe(false)
    expect(hasActiveFilters(filters({ sort: 'title' }))).toBe(false)
    expect(hasActiveFilters(filters({ query: '  ' }))).toBe(false)
    for (const change of [{ query: 'x' }, { status: 'DRAFT' }, { category: 'news' }, { missingCover: true }]) {
      expect(hasActiveFilters(filters(change))).toBe(true)
    }
  })
})

describe('sortArticles', () => {
  const rows = [
    item({ id: 'b', title: 'beta 10', updatedAt: '2026-11-02T00:00:00Z', publishedAt: '2026-10-01T00:00:00Z' }),
    item({ id: 'a', title: 'Alpha', updatedAt: '2026-11-03T00:00:00Z', publishedAt: null }),
    item({ id: 'c', title: 'Beta 9', updatedAt: '2026-11-01T00:00:00Z', publishedAt: '2026-10-20T00:00:00Z' }),
    item({ id: 'd', title: '', updatedAt: '2026-11-04T00:00:00Z', publishedAt: null }),
  ]

  it('recently updated first by default, and the reverse for "least recently updated"', () => {
    expect(ids(sortArticles(rows, 'updated'))).toEqual(['d', 'a', 'b', 'c'])
    expect(ids(sortArticles(rows, 'oldest'))).toEqual(['c', 'b', 'a', 'd'])
  })

  it('newest published first, with never-published articles last', () => {
    expect(ids(sortArticles(rows, 'published'))).toEqual(['c', 'b', 'd', 'a'])
  })

  it('by title, ignoring case, reading numbers as numbers, with untitled drafts last', () => {
    expect(ids(sortArticles(rows, 'title'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('does not reorder the array it was given, and is stable for equal keys', () => {
    const before = ids(rows)
    sortArticles(rows, 'title')
    expect(ids(rows)).toEqual(before)
    const same = [item({ id: 'y' }), item({ id: 'x' })]
    expect(ids(sortArticles(same, 'updated'))).toEqual(['x', 'y'])
  })
})

describe('formatListDate', () => {
  it('formats in UK time with the month names the schedule display uses', () => {
    expect(formatListDate('2026-07-31T23:30:00.000Z')).toBe('1 Aug 2026')
    expect(formatListDate('2026-09-05T12:00:00.000Z')).toBe('5 Sept 2026')
  })

  it('is empty for a missing or unusable date', () => {
    expect(formatListDate(null)).toBe('')
    expect(formatListDate('nope')).toBe('')
  })
})
