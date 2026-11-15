import { describe, expect, it } from 'vitest'
import { editDistance, findExactTag, findTagOverlaps, matchTags, overlapReason, similarTags, tagWordKey, type TagOption } from '@/lib/tags/taxonomy'
import { MAX_ARTICLE_TAGS, RECOMMENDED_ARTICLE_TAGS } from '@/lib/tagIdentity'

let n = 0
const tag = (name: string, over: Partial<TagOption> = {}): TagOption => ({ id: `t${n++}`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), aliases: [], articleCount: 0, retired: false, ...over })

const OPTIONS = [
  tag('Inflation', { aliases: ['CPI', 'Consumer Prices'], articleCount: 12 }),
  tag('Monetary Policy', { articleCount: 9 }),
  tag('Labour Markets', { articleCount: 4 }),
  tag('Trade', { articleCount: 7 }),
  tag('Trade Policy', { articleCount: 2 }),
  tag('Économie', { articleCount: 1 }),
  tag('Old Topic', { retired: true, articleCount: 30 }),
]
const names = (rows: { tag: TagOption }[]) => rows.map((r) => r.tag.name)

describe('limits', () => {
  it('one article limit, with 1–3 recommended', () => {
    expect(MAX_ARTICLE_TAGS).toBe(10)
    expect(RECOMMENDED_ARTICLE_TAGS).toEqual({ min: 1, max: 3 })
  })
})

describe('matchTags', () => {
  it('puts an exact name first, then prefixes, then words, then contains', () => {
    expect(names(matchTags(OPTIONS, 'trade'))).toEqual(['Trade', 'Trade Policy'])
    expect(names(matchTags(OPTIONS, 'pol'))).toEqual(['Monetary Policy', 'Trade Policy'])
  })

  it('finds a tag through an alias, and says which alias matched', () => {
    const [hit] = matchTags(OPTIONS, 'cpi')
    expect(hit).toMatchObject({ exact: true, via: 'CPI' })
    expect(hit.tag.name).toBe('Inflation')
    expect(matchTags(OPTIONS, 'consumer')[0]).toMatchObject({ via: 'Consumer Prices', exact: false })
  })

  it('ignores case, accents and punctuation', () => {
    expect(names(matchTags(OPTIONS, 'MONETARY-POLICY'))).toEqual(['Monetary Policy'])
    expect(names(matchTags(OPTIONS, 'economie'))).toEqual(['Économie'])
  })

  it('never offers a retired tag', () => {
    expect(matchTags(OPTIONS, 'old topic')).toEqual([])
    expect(names(matchTags(OPTIONS, ''))).not.toContain('Old Topic')
  })

  it('lists the most used tags when nothing is typed', () => {
    expect(names(matchTags(OPTIONS, '', 3))).toEqual(['Inflation', 'Monetary Policy', 'Trade'])
  })
})

describe('findExactTag', () => {
  it('finds a tag by name or alias, retired ones included', () => {
    expect(findExactTag(OPTIONS, ' inflation ')?.tag.name).toBe('Inflation')
    expect(findExactTag(OPTIONS, 'Consumer prices')).toMatchObject({ via: 'Consumer Prices' })
    expect(findExactTag(OPTIONS, 'old-topic')?.tag.retired).toBe(true)
    expect(findExactTag(OPTIONS, 'Housing')).toBeNull()
    expect(findExactTag(OPTIONS, '!!!')).toBeNull()
  })
})

describe('overlapReason', () => {
  it.each([
    ['Labour Market', 'Labour Markets', 'same-words'],
    ['the labour market', 'Labour Markets', 'same-words'],
    ['Policies', 'Policy', 'same-words'],
    ['Trade and Tariffs', 'Tariffs & Trade', 'same-words'],
    ['Monetery Policy', 'Monetary Policy', 'spelling'],
    ['Behavioral Economics', 'Behavioural Economics', 'spelling'],
    ['AI', 'Artificial Intelligence', 'acronym'],
    ['Monetary Policy', 'UK Monetary Policy Committee', 'contains'],
  ])('%j and %j: %s', (a, b, reason) => {
    expect(overlapReason(a, b)).toBe(reason)
    expect(overlapReason(b, a)).toBe(reason)
  })

  it.each([
    ['Trade', 'Housing'],
    ['Inflation', 'Inflation'], // the same identity is the same tag, not an overlap
    ['Tax', 'Trade'],
    ['Energy', 'Economy'],
    ['Gas', 'Gap'], // too short to call a typo
    ['Economics', 'Economic Policy'], // different topics despite the shared stem
  ])('%j and %j: no overlap', (a, b) => {
    expect(overlapReason(a, b)).toBeNull()
  })

  it('builds the word key from content words, stemmed and sorted', () => {
    expect(tagWordKey('The Housing Markets')).toBe('housing market')
    expect(tagWordKey('UK')).toBe('uk')
  })

  it('bounds the edit distance', () => {
    expect(editDistance('policy', 'polcy')).toBe(1)
    expect(editDistance('a', 'abcdefgh', 2)).toBe(3)
  })
})

describe('findTagOverlaps', () => {
  it('reports likely duplicates first and counts aliases as names', () => {
    const tags = [
      { id: '1', name: 'Labour Markets' },
      { id: '2', name: 'Labour Market' },
      { id: '3', name: 'Inflation', aliases: ['CPI'] },
      { id: '4', name: 'CPI Inflation' },
      { id: '5', name: 'Housing' },
    ]
    const found = findTagOverlaps(tags)
    expect(found.map((o) => [o.a.name, o.b.name, o.strength])).toEqual([
      ['Labour Markets', 'Labour Market', 'likely'],
      ['Inflation', 'CPI Inflation', 'possible'],
    ])
  })

  it('finds nothing in a clean taxonomy', () => {
    expect(findTagOverlaps([{ id: '1', name: 'Trade' }, { id: '2', name: 'Housing' }])).toEqual([])
  })
})

describe('similarTags', () => {
  it('suggests the existing tag a new wording would duplicate', () => {
    expect(similarTags(OPTIONS, 'Labour Market').map((s) => [s.tag.name, s.reason])).toEqual([['Labour Markets', 'same-words']])
    expect(similarTags(OPTIONS, 'Monetery Policy')[0].tag.name).toBe('Monetary Policy')
  })

  it('never suggests a retired tag', () => {
    expect(similarTags(OPTIONS, 'Old Topics')).toEqual([])
  })
})
