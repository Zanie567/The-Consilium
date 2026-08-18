import { describe, it, expect } from 'vitest'
import {
  ARCHIVE_MAX_QUERY_LENGTH,
  ARCHIVE_PAGE_SIZE,
  buildArchiveHref,
  clampPage,
  normaliseCategorySlug,
  normaliseSearchTerm,
  pageOffset,
  parsePageParam,
  totalPageCount,
} from '@/lib/archivePagination'

/**
 * Guards the two bugs that made /archive reachable-but-wrong once it paginated:
 *
 *   1. A repeated query parameter (`/archive?q=a&q=b`) arrives as a string
 *      array. It used to flow straight into Prisma's `contains`, which threw —
 *      and because the count query had no catch, any visitor could turn that
 *      URL into a 500.
 *   2. Prisma compiles `contains` to `ILIKE ('%' || $n || '%')`, so an
 *      unescaped `%` or `_` in the search box was interpreted as a wildcard:
 *      `?q=%` matched every published article and reported them as "matching".
 */

describe('normaliseSearchTerm', () => {
  it('trims surrounding whitespace', () => {
    expect(normaliseSearchTerm('  markets  ')).toBe('markets')
  })

  it('treats a blank or whitespace-only term as no search', () => {
    expect(normaliseSearchTerm('')).toBeUndefined()
    expect(normaliseSearchTerm('   ')).toBeUndefined()
    expect(normaliseSearchTerm(undefined)).toBeUndefined()
  })

  it('caps the term so a crafted URL cannot drive an unbounded scan', () => {
    const term = normaliseSearchTerm('a'.repeat(5000))
    expect(term).toHaveLength(ARCHIVE_MAX_QUERY_LENGTH)
  })

  it('collapses a repeated q parameter instead of passing an array on', () => {
    expect(normaliseSearchTerm(['first', 'second'])).toBe('first')
  })

  it('strips a NUL, which Postgres rejects outright in a text value', () => {
    const nul = String.fromCharCode(0)
    expect(normaliseSearchTerm(`a${nul}b`)).toBe('ab')
    expect(normaliseSearchTerm(nul)).toBeUndefined()
  })

  it('strips the other control characters a search box cannot use', () => {
    expect(normaliseSearchTerm(`gilt${String.fromCharCode(7)}s`)).toBe('gilts')
    expect(normaliseSearchTerm(`a${String.fromCharCode(0x7f)}b`)).toBe('ab')
  })

  it('keeps ordinary punctuation and non-ASCII text intact', () => {
    expect(normaliseSearchTerm('£sterling — Keynes’ "General Theory"')).toBe(
      '£sterling — Keynes’ "General Theory"'
    )
  })
})

describe('normaliseCategorySlug', () => {
  it('passes an ordinary slug through', () => {
    expect(normaliseCategorySlug('opinion')).toBe('opinion')
  })

  it('collapses a repeated category parameter', () => {
    expect(normaliseCategorySlug(['opinion', 'news'])).toBe('opinion')
  })

  it('strips a NUL so an equality filter cannot fail the query', () => {
    expect(normaliseCategorySlug(`opinion${String.fromCharCode(0)}`)).toBe('opinion')
  })
})

describe('parsePageParam', () => {
  it('defaults to page 1 when absent', () => {
    expect(parsePageParam(undefined)).toBe(1)
  })

  it('reads a valid page number', () => {
    expect(parsePageParam('3')).toBe(3)
  })

  it.each(['0', '-5', 'abc', '', '   ', 'NaN', 'Infinity', '1e999', '0x2'])(
    'falls back to page 1 for %j',
    (value) => {
      expect(parsePageParam(value)).toBe(1)
    }
  )

  it('refuses page numbers beyond the safe integer range', () => {
    expect(parsePageParam('999999999999999999999')).toBe(1)
  })

  it('truncates a fractional page rather than passing it to the database', () => {
    expect(parsePageParam('2.7')).toBe(2)
  })

  it('collapses a repeated page parameter', () => {
    expect(parsePageParam(['2', '5'])).toBe(2)
  })

  it('always returns a value usable as a query offset', () => {
    for (const value of ['0', '-1', 'abc', '1e999', undefined, ['a', 'b']]) {
      const page = parsePageParam(value as string | string[] | undefined)
      expect(Number.isSafeInteger(page)).toBe(true)
      expect(page).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('totalPageCount', () => {
  it('reports a single page for an empty archive', () => {
    expect(totalPageCount(0)).toBe(1)
  })

  it('does not add a trailing empty page on an exact multiple', () => {
    expect(totalPageCount(ARCHIVE_PAGE_SIZE)).toBe(1)
    expect(totalPageCount(ARCHIVE_PAGE_SIZE * 2)).toBe(2)
  })

  it('rounds a partial page up', () => {
    expect(totalPageCount(ARCHIVE_PAGE_SIZE + 1)).toBe(2)
  })
})

describe('clampPage', () => {
  it('keeps a page that exists', () => {
    expect(clampPage(2, 3)).toBe(2)
  })

  it('clamps past the last page instead of erroring or showing nothing', () => {
    expect(clampPage(999, 3)).toBe(3)
  })

  it('never returns less than the first page', () => {
    expect(clampPage(0, 3)).toBe(1)
    expect(clampPage(-4, 3)).toBe(1)
    expect(clampPage(1, 0)).toBe(1)
  })

  it('yields a non-negative offset for every clamped page', () => {
    for (const requested of [-10, 0, 1, 7, 1e9]) {
      const offset = pageOffset(clampPage(requested, 3))
      expect(Number.isSafeInteger(offset)).toBe(true)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(2 * ARCHIVE_PAGE_SIZE)
    }
  })
})

describe('buildArchiveHref', () => {
  it('omits the query string entirely for an unfiltered first page', () => {
    expect(buildArchiveHref(1)).toBe('/archive')
  })

  it('omits page=1 so the first page keeps one address', () => {
    expect(buildArchiveHref(1, 'markets')).toBe('/archive?q=markets')
  })

  it('preserves the active search and category filters', () => {
    expect(buildArchiveHref(2, 'markets', 'opinion')).toBe(
      '/archive?q=markets&category=opinion&page=2'
    )
  })

  it('encodes terms that would otherwise break the query string', () => {
    const href = buildArchiveHref(2, 'a&b=c d', 'opinion')
    expect(href).toBe('/archive?q=a%26b%3Dc+d&category=opinion&page=2')
    // The path must stay /archive — no parameter can introduce a second path.
    expect(new URL(href, 'https://example.test').pathname).toBe('/archive')
  })
})
