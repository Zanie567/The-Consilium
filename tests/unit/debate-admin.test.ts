import { describe, it, expect } from 'vitest'
import { format } from 'date-fns'
import { debateVisibility, publicDebateWhere, PUBLIC_DEBATE_WHERE, DEBATE_OWN_STATE_PUBLISHED_WHERE } from '@/lib/debateVisibility'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { buildDebateRow, debatePurgeMessage, filterDebateRows, sortDebateRows, type DebateRecord } from '@/lib/debateAdmin'
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
  it('public means the debate is published AND both articles are public; isActive is not part of it', () => {
    expect(PUBLIC_DEBATE_WHERE).toMatchObject({ deletedAt: null, unpublishedAt: null })
    // Both arguments must satisfy the one article rule (PUBLISHED, not trashed, not part of a hidden debate).
    for (const side of ['forArticle', 'againstArticle'] as const) {
      expect(PUBLIC_DEBATE_WHERE[side]).toEqual(publishedArticleWhere())
    }
    expect(PUBLIC_DEBATE_WHERE).not.toHaveProperty('isActive')
  })
  it('narrowing a public query can only add conditions, never replace one', () => {
    expect(publicDebateWhere()).toBe(PUBLIC_DEBATE_WHERE)
    expect(publicDebateWhere({ isActive: true })).toEqual({ AND: [PUBLIC_DEBATE_WHERE, { isActive: true }] })
    // Even a caller that tries to override a visibility field is ANDed with the rule, not substituted for it.
    expect(publicDebateWhere({ deletedAt: { not: null }, forArticle: { status: 'ARCHIVED' } })).toEqual({
      AND: [PUBLIC_DEBATE_WHERE, { deletedAt: { not: null }, forArticle: { status: 'ARCHIVED' } }],
    })
  })
  it('the debate\'s own published state is exposed separately, for administrative classification only', () => {
    expect(DEBATE_OWN_STATE_PUBLISHED_WHERE).toEqual({ deletedAt: null, unpublishedAt: null })
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

describe('permanent-delete confirmation (approved policy 2026-11-09)', () => {
  const NOW = d('2026-11-09T12:00:00Z')
  const DAY = 24 * 60 * 60 * 1000
  const row = (forDeletedAt: Date | null, againstDeletedAt: Date | null, votes = { for: 5, against: 3 }) =>
    buildDebateRow(
      debate({
        forArticle: article({ deletedAt: forDeletedAt }),
        againstArticle: article({ id: 'a2', title: 'Tariffs hurt', slug: 'tariffs-hurt', deletedAt: againstDeletedAt }),
      }),
      votes,
      NOW,
    )
  const longAgo = d('2026-10-09T12:00:00Z') // 31 days before NOW
  const recently = d('2026-10-11T12:00:00Z') // 29 days before NOW

  it('exposes when each article went to the Trash', () => {
    const r = row(longAgo, null)
    expect(r.articles.map((a) => a.trashedAt)).toEqual(['2026-10-09T12:00:00.000Z', null])
  })

  it('names the debate and says every vote is lost for good, with the counts', () => {
    const text = debatePurgeMessage(row(null, null), NOW)
    expect(text).toContain('"Should tariffs rise?"')
    expect(text).toContain('all 8 votes on it (5 for, 3 against)')
    expect(text).toContain('cannot be recovered')
  })

  it('a debate with no votes says so rather than claiming votes are lost', () => {
    expect(debatePurgeMessage(row(null, null, { for: 0, against: 0 }), NOW)).toContain('no votes have been cast')
  })

  it('says the articles are not deleted now, keep their Trash dates, and are only deletable once no debate refers to them', () => {
    const text = debatePurgeMessage(row(longAgo, null), NOW)
    expect(text).toContain('Its articles are not deleted now and their Trash dates are not reset.')
    // Another debate may reference the same article: removing this one alone guarantees nothing.
    expect(text).toContain('Once no debate refers to an article')
    expect(text).toContain('after its Trash retention period, which is at least 30 days from the date it was trashed')
  })

  it('an article past the 30-day minimum gets a warning, not a deletion date or an "immediately"', () => {
    const text = debatePurgeMessage(row(longAgo, null), NOW)
    expect(text).toContain('"Tariffs help" has been in the Trash since 9 Oct 2026, longer than the 30-day minimum, so it is no longer guaranteed to be restorable: restore it first if you want to keep it.')
  })

  it('an article inside the minimum gets its guaranteed restore window, counted from its ORIGINAL trash date', () => {
    const text = debatePurgeMessage(row(null, recently), NOW)
    const until = format(new Date(recently.getTime() + 30 * DAY), 'd MMM yyyy, HH:mm')
    expect(text).toContain(`"Tariffs hurt" has been in the Trash since 11 Oct 2026 and can be restored until at least ${until}.`)
  })

  it('an article not in the Trash yet can be restored for at least 30 days', () => {
    expect(debatePurgeMessage(row(null, null), NOW)).toContain('"Tariffs help" moves to the article Trash now and can be restored for at least 30 days.')
  })

  // TRASH_RETENTION_DAYS can only lengthen retention (clampRetentionDays, tested in trash-purge.test.ts), and the
  // dialog cannot know the configured value. Every statement must stay true for any retention of 30 days or more.
  it.each([30, 45, 90, 365])('makes no claim that is false with %i-day retention', (retentionDays) => {
    for (const r of [row(longAgo, recently), row(null, null), row(d('2026-01-01T00:00:00Z'), d('2026-11-09T11:00:00Z'))]) {
      const text = debatePurgeMessage(r, NOW)
      // Never a definite deletion: no "will be deleted", no "next clean-up", no "after N days" deadline.
      expect(text).not.toMatch(/will be (permanently )?deleted|next (daily )?clean-up|deleted after \d+ days|immediately/i)
      // Any restore-until date it states is no later than the real earliest deletion under this retention.
      for (const a of r.articles.filter((x) => x.trashedAt)) {
        const earliestDeletion = new Date(new Date(a.trashedAt!).getTime() + retentionDays * DAY)
        const stated = new Date(new Date(a.trashedAt!).getTime() + 30 * DAY)
        if (text.includes(format(stated, 'd MMM yyyy, HH:mm'))) expect(stated.getTime()).toBeLessThanOrEqual(earliestDeletion.getTime())
      }
    }
  })
})
