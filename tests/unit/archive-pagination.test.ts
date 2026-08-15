import { describe, it, expect } from 'vitest'
import {
  ARCHIVE_MAX_QUERY_LENGTH,
  ARCHIVE_PAGE_SIZE,
  buildArchiveHref,
  clampPage,
  escapeLikePattern,
  firstParam,
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
describe('firstParam', () => {
  it('passes a single string through', () => {
    expect(firstParam('opinion')).toBe('opinion')
  })

  it('collapses a repeated parameter to its first value', () => {
    expect(firstParam(['a', 'b'])).toBe('a')
  })

  it('returns undefined for an absent or empty parameter', () => {
    expect(firstParam(undefined)).toBeUndefined()
    expect(firstParam([])).toBeUndefined()
  })
})

describe('escapeLikePattern', () => {
  it('leaves ordinary search terms untouched', () => {
    expect(escapeLikePattern('inflation')).toBe('inflation')
  })

  it('escapes the LIKE wildcards so they match literally', () => {
    expect(escapeLikePattern('%')).toBe('\\%')
    expect(escapeLikePattern('_')).toBe('\\_')
    expect(escapeLikePattern('100%')).toBe('100\\%')
  })

  it('escapes the escape character itself', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
  })

  it('escapes every metacharacter in a hostile pattern', () => {
    expect(escapeLikePattern('%_%_%')).toBe('\\%\\_\\%\\_\\%')
  })
})

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
