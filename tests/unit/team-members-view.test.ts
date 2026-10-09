import { describe, it, expect } from 'vitest'
import type { MemberRow } from '@/lib/membership'
import { filterMembers, sortMembers, summariseMembers, needsProfile, isNewWithoutProfile } from '@/lib/teamMembersView'

const NOW = new Date('2026-10-10T12:00:00Z')
const row = (over: Partial<MemberRow> & { id: string }): MemberRow => ({
  email: `${over.id}@ed.ac.uk`, name: over.id, role: 'WRITER', hasAccount: true, emailVerified: true,
  accountStatus: 'active', profileStatus: 'published', position: 'Writer', tier: null, order: 1, visible: true,
  missingFromMember: [], missingFromAdmin: [], invitedByName: null, createdAt: '2026-01-01T00:00:00.000Z',
  userId: `u-${over.id}`, accountCreatedAt: '2026-01-01T00:00:00.000Z',
  card: { id: `c-${over.id}`, name: over.id, position: 'Writer', publicTier: null, bio: 'bio', image: null, email: null, order: 1, visible: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  ...over,
})

const rows: MemberRow[] = [
  row({ id: 'ada', name: 'Ada Admin', role: 'ADMIN', position: 'Editor-in-Chief', accountCreatedAt: '2026-02-01T00:00:00.000Z' }),
  row({ id: 'newbie', name: 'Newbie Writer', accountCreatedAt: '2026-10-08T00:00:00.000Z', profileStatus: 'not-started', card: null, position: null, visible: null, order: null }),
  row({ id: 'oldbie', name: 'Old Writer', accountCreatedAt: '2026-03-01T00:00:00.000Z', profileStatus: 'not-started', card: null, position: null, visible: null, order: null }),
  row({ id: 'hidden', name: 'Hidden Editor', role: 'EDITOR', profileStatus: 'hidden', visible: false, position: 'Editor', accountCreatedAt: '2026-04-01T00:00:00.000Z' }),
  row({ id: 'invitee', name: null, email: 'invitee@ed.ac.uk', hasAccount: false, userId: null, accountStatus: 'invited', profileStatus: 'not-started', card: null, accountCreatedAt: null, position: null }),
  row({ id: 'gone', name: 'Gone Person', accountStatus: 'revoked', profileStatus: 'not-started', card: null, accountCreatedAt: '2026-05-01T00:00:00.000Z' }),
]

describe('needs a profile', () => {
  it('means an account with team access and no card', () => {
    expect(rows.filter(needsProfile).map((r) => r.id)).toEqual(['newbie', 'oldbie'])
  })
  it('an invitation without an account, a revoked member or one with a card do not need one', () => {
    for (const id of ['invitee', 'gone', 'ada', 'hidden']) expect(needsProfile(rows.find((r) => r.id === id)!)).toBe(false)
  })
  it('only recently created accounts are flagged as new', () => {
    expect(isNewWithoutProfile(rows[1], NOW)).toBe(true)
    expect(isNewWithoutProfile(rows[2], NOW)).toBe(false)
    expect(isNewWithoutProfile(rows[0], NOW)).toBe(false)
  })
})

describe('filterMembers', () => {
  const ids = (f: Parameters<typeof filterMembers>[1]) => filterMembers(rows, f).map((r) => r.id)
  it('filters by profile state', () => {
    expect(ids({ query: '', filter: 'all' })).toHaveLength(6)
    expect(ids({ query: '', filter: 'needs-profile' })).toEqual(['newbie', 'oldbie'])
    expect(ids({ query: '', filter: 'published' })).toEqual(['ada'])
    expect(ids({ query: '', filter: 'hidden' })).toEqual(['hidden'])
    expect(ids({ query: '', filter: 'invited' })).toEqual(['invitee'])
    expect(ids({ query: '', filter: 'revoked' })).toEqual(['gone'])
  })
  it('searches name, email, position and role, ignoring case', () => {
    expect(ids({ query: 'EDITOR-IN-CHIEF', filter: 'all' })).toEqual(['ada'])
    expect(ids({ query: 'invitee@', filter: 'all' })).toEqual(['invitee'])
    expect(ids({ query: 'editor', filter: 'all' }).sort()).toEqual(['ada', 'hidden'])
    expect(ids({ query: 'nobody', filter: 'all' })).toEqual([])
    expect(ids({ query: 'writer', filter: 'needs-profile' })).toEqual(['newbie', 'oldbie'])
  })
})

describe('sortMembers', () => {
  const order = (s: Parameters<typeof sortMembers>[1]) => sortMembers(rows, s).map((r) => r.id)
  it('puts the newest accounts first by default', () => {
    expect(order('recent').slice(0, 2)).toEqual(['newbie', 'gone'])
  })
  it('sorts by name, position (untitled last) and role', () => {
    expect(order('name')[0]).toBe('ada')
    const byPosition = order('position')
    expect(byPosition.slice(0, 2)).toEqual(['hidden', 'ada']) // "Editor" < "Editor-in-Chief"
    // Untitled people (no card, or an invitation) sort after everyone with a title.
    const untitled = new Set(['newbie', 'oldbie', 'invitee', 'gone'])
    expect(byPosition.slice(-4).every((id) => untitled.has(id))).toBe(true)
    expect(order('role').slice(0, 2)).toEqual(['ada', 'hidden'])
  })
})

describe('summariseMembers', () => {
  it('counts what the header shows', () => {
    expect(summariseMembers(rows)).toEqual({ total: 6, needProfile: 2, publicProfiles: 1, notPublic: 1, pendingInvites: 1 })
  })
})
