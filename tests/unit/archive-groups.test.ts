import { describe, expect, it } from 'vitest'
import { archiveDateTimeAttr, formatArchiveDate, groupByMonth } from '@/lib/archiveGroups'

const article = (id: string, publishedAt: string | Date | null) => ({ id, publishedAt })

describe('groupByMonth', () => {
  it('groups consecutive articles of one month and keeps the incoming order', () => {
    const groups = groupByMonth([
      article('a', '2026-11-12T10:00:00Z'),
      article('b', '2026-11-01T10:00:00Z'),
      article('c', '2026-10-20T10:00:00Z'),
      article('d', '2025-11-20T10:00:00Z'),
    ])
    expect(groups.map((g) => [g.key, g.month, g.year, g.articles.map((a) => a.id)])).toEqual([
      ['2026-11', 'November', '2026', ['a', 'b']],
      ['2026-10', 'October', '2026', ['c']],
      ['2025-11', 'November', '2025', ['d']],
    ])
  })

  it('reads the month in UK time, not UTC', () => {
    // 23:30 UTC on 31 July is 00:30 on 1 August in Edinburgh (British Summer Time).
    const [group] = groupByMonth([article('a', '2026-07-31T23:30:00Z')])
    expect([group.key, group.month]).toEqual(['2026-08', 'August'])
    // In winter the UK is on UTC, so the same clock time stays in its UTC month.
    expect(groupByMonth([article('b', '2026-01-31T23:30:00Z')])[0].key).toBe('2026-01')
  })

  it('accepts Date objects and ISO strings alike', () => {
    const groups = groupByMonth([article('a', new Date('2026-03-05T12:00:00Z')), article('b', '2026-03-01T12:00:00Z')])
    expect(groups).toHaveLength(1)
    expect(groups[0].articles).toHaveLength(2)
  })

  it('puts published articles without a usable date in an "Undated" group', () => {
    const groups = groupByMonth([article('a', '2026-03-05T12:00:00Z'), article('b', null), article('c', 'not a date')])
    expect(groups.map((g) => [g.key, g.month, g.year, g.articles.length])).toEqual([
      ['2026-03', 'March', '2026', 1],
      ['undated', 'Undated', '', 2],
    ])
  })

  it('returns no groups for an empty page', () => {
    expect(groupByMonth([])).toEqual([])
  })
})

describe('archive dates', () => {
  it('formats in UK time', () => {
    expect(formatArchiveDate('2026-07-31T23:30:00Z')).toMatch(/^1 Aug 2026$/)
    expect(formatArchiveDate(new Date('2026-11-12T10:00:00Z'))).toMatch(/^12 Nov 2026$/)
  })

  it('is empty, never "Invalid Date", when there is no usable date', () => {
    expect(formatArchiveDate(null)).toBe('')
    expect(formatArchiveDate('nonsense')).toBe('')
    expect(archiveDateTimeAttr(null)).toBeUndefined()
    expect(archiveDateTimeAttr('2026-11-12T10:00:00Z')).toBe('2026-11-12T10:00:00.000Z')
  })
})
