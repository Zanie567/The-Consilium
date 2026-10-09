import { describe, it, expect } from 'vitest'
import { debateVisibility, publicDebateWhere, PUBLIC_DEBATE_WHERE } from '@/lib/debateVisibility'
import { buildDebateRow, filterDebateRows, sortDebateRows, type DebateRecord } from '@/lib/debateAdmin'
import { isDebateAction, DEBATE_ACTIONS } from '@/lib/debateLifecycle'

const d = (iso: string) => new Date(iso)
const article = (over: Partial<DebateRecord['forArticle']> = {}): DebateRecord['forArticle'] => ({
  id: 'a1', title: 'Tariffs help', slug: 'tariffs-help', status: 'PUBLISHED',
  deletedAt: null, publishedAt: d('2026-09-01T00:00:00Z'), authorName: 'Ada Writer', ...over,
})
const debate = (over: Partial<DebateRecord> = {}): DebateRecord => ({
  id: 'd1', title: 'Should tariffs rise?', description: 'A trade debate', isActive: true, closesAt: null,
  createdAt: d('2026-09-01T00:00:00Z'), updatedAt: d('2026-09-02T00:00:00Z'),
  unpublishedAt: null, deletedAt: null, deletedById: null,
  forArticle: article(), againstArticle: article({ id: 'a2', title: 'Tariffs hurt', slug: 'tariffs-hurt', authorName: 'Bo Opinion' }),
  ...over,
})

describe('debate visibility', () => {
  it('public means neither unpublished nor deleted; isActive is not part of it', () => {
    expect(PUBLIC_DEBATE_WHERE).toEqual({ deletedAt: null, unpublishedAt: null })
    expect(publicDebateWhere({ isActive: true })).toEqual({ deletedAt: null, unpublishedAt: null, isActive: true })
    expect(publicDebateWhere({ id: 'x' })).toMatchObject({ id: 'x', deletedAt: null, unpublishedAt: null })
  })
  it('deleted wins over unpublished', () => {
    expect(debateVisibility({ unpublishedAt: null, deletedAt: null })).toBe('published')
    expect(debateVisibility({ unpublishedAt: d('2026-01-01'), deletedAt: null })).toBe('unpublished')
    expect(debateVisibility({ unpublishedAt: d('2026-01-01'), deletedAt: d('2026-01-02') })).toBe('deleted')
    expect(debateVisibility({ unpublishedAt: null, deletedAt: d('2026-01-02') })).toBe('deleted')
  })
})

describe('debate actions', () => {
  it('accepts exactly the five lifecycle actions', () => {
    expect([...DEBATE_ACTIONS]).toEqual(['unpublish', 'publish', 'delete', 'restore', 'purge'])
    for (const a of DEBATE_ACTIONS) expect(isDebateAction(a)).toBe(true)
    for (const bad of ['', 'DELETE', 'drop', 5, null, undefined, {}]) expect(isDebateAction(bad)).toBe(false)
  })
})

describe('buildDebateRow', () => {
  it('summarises a live featured debate', () => {
    const row = buildDebateRow(debate(), { for: 3, against: 1 })
    expect(row).toMatchObject({
      visibility: 'published', featured: true, closed: false, outOfSync: null,
      votes: { for: 3, against: 1, total: 4 }, publishedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(row.articles.map((a) => [a.side, a.author])).toEqual([['FOR', 'Ada Writer'], ['AGAINST', 'Bo Opinion']])
  })
  it('a hidden debate is never "featured", even if the flag is stale', () => {
    expect(buildDebateRow(debate({ unpublishedAt: d('2026-09-03') }), { for: 0, against: 0 }).featured).toBe(false)
  })
  it('reports voting closed once closesAt has passed', () => {
    expect(buildDebateRow(debate({ closesAt: d('2026-09-10') }), { for: 0, against: 0 }, d('2026-09-11')).closed).toBe(true)
    expect(buildDebateRow(debate({ closesAt: d('2026-09-10') }), { for: 0, against: 0 }, d('2026-09-09')).closed).toBe(false)
  })
  it('flags a hidden debate whose article is still public, and a public debate with a non-public side', () => {
    const hidden = buildDebateRow(debate({ unpublishedAt: d('2026-09-03') }), { for: 0, against: 0 })
    expect(hidden.outOfSync).toMatch(/still publicly visible/)
    const synced = buildDebateRow(
      debate({ unpublishedAt: d('2026-09-03'), forArticle: article({ status: 'ARCHIVED' }), againstArticle: article({ id: 'a2', status: 'ARCHIVED' }) }),
      { for: 0, against: 0 },
    )
    expect(synced.outOfSync).toBeNull()
    const broken = buildDebateRow(debate({ againstArticle: article({ id: 'a2', deletedAt: d('2026-09-04') }) }), { for: 0, against: 0 })
    expect(broken.outOfSync).toMatch(/not public/)
    expect(broken.articles[1].trashed).toBe(true)
  })
})

describe('filtering and sorting', () => {
  const rows = [
    buildDebateRow(debate({ id: 'live', title: 'Should tariffs rise?' }), { for: 0, against: 0 }),
    buildDebateRow(debate({ id: 'hid', title: 'Rent control', unpublishedAt: d('2026-09-03'), forArticle: article({ authorName: 'Cy Contributor', title: 'Cap rents', status: 'ARCHIVED' }), againstArticle: article({ id: 'a9', status: 'ARCHIVED' }) }), { for: 0, against: 0 }),
    buildDebateRow(debate({ id: 'del', title: 'Crypto', deletedAt: d('2026-09-04'), unpublishedAt: d('2026-09-04'), createdAt: d('2026-09-05') }), { for: 0, against: 0 }),
  ]
  it('filters by status', () => {
    expect(filterDebateRows(rows, { query: '', status: 'all' })).toHaveLength(3)
    expect(filterDebateRows(rows, { query: '', status: 'published' }).map((r) => r.id)).toEqual(['live'])
    expect(filterDebateRows(rows, { query: '', status: 'unpublished' }).map((r) => r.id)).toEqual(['hid'])
    expect(filterDebateRows(rows, { query: '', status: 'deleted' }).map((r) => r.id)).toEqual(['del'])
  })
  it('searches title, description, article titles and contributors, case-insensitively', () => {
    expect(filterDebateRows(rows, { query: 'rent', status: 'all' }).map((r) => r.id)).toEqual(['hid'])
    expect(filterDebateRows(rows, { query: 'CY CONTRIBUTOR', status: 'all' }).map((r) => r.id)).toEqual(['hid'])
    expect(filterDebateRows(rows, { query: 'cap rents', status: 'all' }).map((r) => r.id)).toEqual(['hid'])
    expect(filterDebateRows(rows, { query: 'trade debate', status: 'all' })).toHaveLength(3)
    expect(filterDebateRows(rows, { query: 'zzz-no-match', status: 'all' })).toEqual([])
    expect(filterDebateRows(rows, { query: 'crypto', status: 'published' })).toEqual([])
  })
  it('puts deleted debates last, then newest first', () => {
    expect(sortDebateRows(rows).map((r) => r.id)).toEqual(['live', 'hid', 'del'])
  })
})
