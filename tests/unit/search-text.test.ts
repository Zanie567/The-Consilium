import { describe, it, expect } from 'vitest'
import {
  escapeLikePattern,
  firstParam,
  normaliseSearchText,
  stripControlCharacters,
} from '@/lib/searchText'

/**
 * Guards the three ways untrusted text used to break a public search surface:
 *
 *   1. A repeated query parameter (`?q=a&q=b`) arrives as a string array and
 *      reached Prisma unchanged, where it threw — an uncaught count query then
 *      turned that into a 500 for any visitor.
 *   2. Prisma compiles `contains` to `ILIKE ('%' || $n || '%')`, so an
 *      unescaped `%` or `_` was read as a wildcard: `?q=%` matched and counted
 *      every published article.
 *   3. A NUL survives URL decoding and passes Prisma's validation, then fails
 *      the query itself with `invalid byte sequence for encoding "UTF8": 0x00`.
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

describe('stripControlCharacters', () => {
  it('removes a NUL, which Postgres rejects in a text value', () => {
    expect(stripControlCharacters(`a${String.fromCharCode(0)}b`)).toBe('ab')
  })

  it('removes the rest of the C0 range and DEL', () => {
    expect(stripControlCharacters(`a${String.fromCharCode(7)}b${String.fromCharCode(0x7f)}`)).toBe(
      'ab'
    )
  })

  it('leaves ordinary punctuation and non-ASCII text alone', () => {
    expect(stripControlCharacters('£ — Keynes\u2019 "General Theory"')).toBe(
      '£ — Keynes\u2019 "General Theory"'
    )
  })
})

describe('normaliseSearchText', () => {
  it('trims and collapses a repeated parameter', () => {
    expect(normaliseSearchText(['  markets  ', 'second'], 200)).toBe('markets')
  })

  it('treats blank, whitespace-only and absent input as no search', () => {
    expect(normaliseSearchText('', 200)).toBeUndefined()
    expect(normaliseSearchText('   ', 200)).toBeUndefined()
    expect(normaliseSearchText(undefined, 200)).toBeUndefined()
    expect(normaliseSearchText(String.fromCharCode(0), 200)).toBeUndefined()
  })

  it('caps the term so a crafted URL cannot drive an unbounded scan', () => {
    expect(normaliseSearchText('a'.repeat(5000), 200)).toHaveLength(200)
  })
})
