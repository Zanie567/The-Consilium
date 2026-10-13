import { describe, it, expect } from 'vitest'
import { parseCardFields, cleanImageRef, suggestCards, TeamCardError } from '@/lib/teamCards'
import { buildReconciliationReport, type ReportAccount, type ReportCard } from '@/lib/teamReconciliation'

const fails = (fn: () => unknown, code = 'INVALID_FIELD') => {
  try { fn() } catch (e) { expect(e).toBeInstanceOf(TeamCardError); expect((e as TeamCardError).code).toBe(code); return }
  throw new Error('expected a TeamCardError')
}

describe('parseCardFields', () => {
  it('leaves absent fields out entirely so they are never overwritten', () => {
    expect(parseCardFields({})).toEqual({})
    expect(parseCardFields({ bio: 'x' })).toEqual({ bio: 'x' })
  })
  it('maps the admin vocabulary onto the stored columns', () => {
    expect(parseCardFields({ name: '  Ada L  ', position: ' Editor-in-Chief ', publicTier: 'editor_in_chief', visible: true, order: 3, email: 'a@b.co' }))
      .toEqual({ name: 'Ada L', role: 'Editor-in-Chief', publicTier: 'editor_in_chief', isActive: true, order: 3, email: 'a@b.co' })
  })
  it('clears optional fields with null or empty string', () => {
    expect(parseCardFields({ position: null, publicTier: '', bio: '', image: '', email: null }))
      .toEqual({ role: '', publicTier: null, bio: null, image: null, email: null })
  })
  it.each([
    [{ name: '   ' }], [{ name: 5 }], [{ name: 'x'.repeat(101) }], [{ position: 'x'.repeat(101) }],
    [{ publicTier: 'ceo' }], [{ publicTier: 7 }], [{ order: -1 }], [{ order: 10000 }], [{ order: 1.5 }], [{ order: '3' }],
    [{ visible: 'yes' }], [{ email: 'not-an-email' }], [{ bio: 'x'.repeat(5000) }], [{ image: 'javascript:alert(1)' }],
  ])('rejects %j', (input) => fails(() => parseCardFields(input as never)))
})

describe('cleanImageRef', () => {
  it('accepts https/http URLs and site-relative paths only', () => {
    expect(cleanImageRef('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(cleanImageRef('/team/x.png')).toBe('/team/x.png')
    expect(cleanImageRef('')).toBeNull()
    expect(cleanImageRef(null)).toBeNull()
    for (const bad of ['//evil.example/x.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'ftp://x/y.png', 'not a url', 42]) {
      fails(() => cleanImageRef(bad as never))
    }
  })
})

describe('suggestCards', () => {
  const cards = [
    { id: 'c1', name: 'Grace Hopper', role: 'Writer', email: 'grace@ed.ac.uk' },
    { id: 'c2', name: 'grace   HOPPER', role: 'Writer', email: null },
    { id: 'c3', name: 'Someone Else', role: 'Writer', email: 'GRACE@ed.ac.uk' },
    { id: 'c4', name: 'Unrelated', role: 'Writer', email: 'u@ed.ac.uk' },
  ]
  it('proposes email matches first, name matches as hints, and nothing unrelated', () => {
    const out = suggestCards({ email: 'Grace@ed.ac.uk', name: 'Grace Hopper' }, cards)
    expect(out.map((s) => s.cardId)).toEqual(['c1', 'c3', 'c2'])
    expect(out[0].reasons).toEqual(['email', 'name'])
    expect(out[2].reasons).toEqual(['name'])
  })
  it('suggests nothing for an account with no name and no matching email', () => {
    expect(suggestCards({ email: 'zzz@ed.ac.uk', name: null }, cards)).toEqual([])
  })
})

describe('buildReconciliationReport', () => {
  const account = (over: Partial<ReportAccount> & { id: string }): ReportAccount => ({
    email: `${over.id}@ed.ac.uk`, name: null, role: 'WRITER', isActive: true, isBanned: false, ...over,
  })
  const card = (over: Partial<ReportCard> & { id: string }): ReportCard => ({
    name: over.id, position: 'Writer', email: null, userId: null, visible: true, ...over,
  })
  const kinds = (i: ReturnType<typeof buildReconciliationReport>) => i.map((x) => x.kind)

  it('is empty for a consistent roster', () => {
    const report = buildReconciliationReport({
      accounts: [account({ id: 'u1' })],
      cards: [card({ id: 'c1', userId: 'u1' })],
      memberships: [{ id: 'm1', email: 'u1@ed.ac.uk', role: 'WRITER', status: 'ACTIVE', userId: 'u1' }],
    })
    expect(report).toEqual([])
  })
  it('offers an email match as a likely owner but never as a decision', () => {
    const r = buildReconciliationReport({ accounts: [account({ id: 'u1' })], cards: [card({ id: 'c1', email: 'U1@ed.ac.uk' })], memberships: [] })
    expect(r.find((i) => i.kind === 'unlinked-card-matches-account')).toMatchObject({ cardIds: ['c1'], accountIds: ['u1'], severity: 'review' })
  })
  it('reports several candidate accounts as ambiguous', () => {
    const r = buildReconciliationReport({
      accounts: [account({ id: 'a', email: 'dup@ed.ac.uk' }), account({ id: 'b', email: 'DUP@ed.ac.uk' })],
      cards: [card({ id: 'c1', email: 'dup@ed.ac.uk' })],
      memberships: [],
    })
    expect(kinds(r)).toContain('unlinked-card-ambiguous')
    expect(kinds(r)).not.toContain('unlinked-card-matches-account')
  })
  it('an administrator without a card is informational, unless an existing card looks like theirs', () => {
    const plain = buildReconciliationReport({ accounts: [account({ id: 'adm', role: 'ADMIN' })], cards: [], memberships: [] })
    expect(plain).toMatchObject([{ kind: 'admin-without-profile', severity: 'info' }])
    const chief = buildReconciliationReport({
      accounts: [account({ id: 'adm', role: 'ADMIN', name: 'Alex Chief' })],
      cards: [card({ id: 'eic', name: 'alex  chief', position: 'Editor-in-Chief' })],
      memberships: [],
    })
    expect(chief.find((i) => i.kind === 'admin-without-profile')).toMatchObject({ severity: 'review', cardIds: ['eic'] })
  })
  it('flags staff without a profile, duplicate names, ineligible owners, likely mis-links and role drift', () => {
    const r = buildReconciliationReport({
      accounts: [
        account({ id: 'w', role: 'WRITER' }),
        account({ id: 'gone', role: 'EDITOR', isActive: false }),
        account({ id: 'x', email: 'x@ed.ac.uk' }),
        account({ id: 'y', email: 'y@ed.ac.uk' }),
        account({ id: 'drift', role: 'EDITOR' }),
      ],
      cards: [
        card({ id: 'k1', name: 'Same Name' }), card({ id: 'k2', name: 'same name' }),
        card({ id: 'k3', name: 'Left', userId: 'gone' }),
        card({ id: 'k4', name: 'Mixed Up', userId: 'x', email: 'y@ed.ac.uk' }),
      ],
      memberships: [{ id: 'm', email: 'drift@ed.ac.uk', role: 'WRITER', status: 'ACTIVE', userId: 'drift' }],
    })
    expect(kinds(r)).toEqual(expect.arrayContaining(['staff-without-profile', 'duplicate-profile-name', 'linked-account-not-eligible', 'possible-mislink', 'role-drift']))
    expect(r.find((i) => i.kind === 'duplicate-profile-name')?.cardIds.sort()).toEqual(['k1', 'k2'])
    expect(r.every((i, idx) => idx === 0 || !(r[idx - 1].severity === 'info' && i.severity === 'review'))).toBe(true)
  })
  it('ignores revoked or unclaimed memberships when checking role drift', () => {
    const r = buildReconciliationReport({
      accounts: [account({ id: 'a', role: 'READER' })], cards: [],
      memberships: [{ id: 'm', email: 'a@ed.ac.uk', role: 'WRITER', status: 'REVOKED', userId: 'a' }, { id: 'n', email: 'p@ed.ac.uk', role: 'WRITER', status: 'PENDING', userId: null }],
    })
    expect(kinds(r)).not.toContain('role-drift')
  })
})
