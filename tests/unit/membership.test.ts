import { describe, expect, it } from 'vitest'
import {
  ASSIGNABLE_ROLES,
  describeMember,
  isAssignableRole,
  isPlausibleEmail,
  normalizeEmail,
} from '@/lib/membership'
import { assessProfile } from '@/lib/teamProfiles'

describe('normalizeEmail', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normalizeEmail('  Jane@Example.COM \n')).toBe('jane@example.com')
  })
})

describe('isPlausibleEmail', () => {
  it.each(['a@b.co', 'jane.doe+x@ed.ac.uk'])('accepts %s', (value) => expect(isPlausibleEmail(value)).toBe(true))
  it.each(['', 'jane', 'jane@', '@x.y', 'a b@c.de', `${'a'.repeat(250)}@x.yz`])('rejects %j', (value) =>
    expect(isPlausibleEmail(value)).toBe(false),
  )
})

describe('assignable roles', () => {
  it('are exactly the four staff roles; READER and anything else is not a grant', () => {
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(['ADMIN', 'EDITOR', 'GROWTH', 'WRITER'])
    for (const value of ['READER', 'admin', 'SUPERUSER', '', null, undefined, 1, {}]) {
      expect(isAssignableRole(value)).toBe(false)
    }
  })
})

describe('assessProfile', () => {
  const ready = { name: 'Jane', bio: 'Bio', image: '/p.png', position: 'Writer', visible: true }

  it('is complete and public when everything is present', () => {
    expect(assessProfile(ready)).toMatchObject({ complete: true, publiclyVisible: true, publicBlockers: [] })
  })

  it('a photo is part of "complete" but is not needed to appear', () => {
    expect(assessProfile({ ...ready, image: null })).toMatchObject({
      complete: false,
      publiclyVisible: true,
      missingFromMember: ['photo'],
    })
  })

  it.each([
    ['name', { name: '  ' }],
    ['bio', { bio: null }],
    ['position', { position: '' }],
    ['hidden', { visible: false }],
  ] as const)('is never public without %s', (blocker, change) => {
    const result = assessProfile({ ...ready, ...change })
    expect(result.publiclyVisible).toBe(false)
    expect(result.publicBlockers).toContain(blocker)
  })

  it('separates what the member can fix from what only an admin can', () => {
    expect(assessProfile({ ...ready, bio: '', position: '' })).toMatchObject({
      missingFromMember: ['bio'],
      missingFromAdmin: ['position'],
    })
  })
})

describe('describeMember', () => {
  const base = {
    id: 'm1',
    email: 'jane@example.com',
    role: 'WRITER' as const,
    status: 'PENDING' as const,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    invitedByName: 'Admin',
    publicPosition: null,
    publicTier: null,
    displayName: null,
    user: null,
  }
  const card = { name: 'Jane', bio: 'Bio', image: '/p.png', role: 'Writer', publicTier: 'writer', order: 3, isActive: true }
  const user = { name: 'Jane', role: 'WRITER' as const, emailVerified: new Date(), isActive: true, isBanned: false, teamProfile: card }

  it('invited, not registered', () => {
    expect(describeMember(base)).toMatchObject({ accountStatus: 'invited', hasAccount: false, profileStatus: 'not-started' })
  })

  it('registered but the address is not confirmed', () => {
    expect(describeMember({ ...base, unclaimedAccount: { emailVerified: false } })).toMatchObject({
      accountStatus: 'unverified',
      hasAccount: true,
    })
  })

  it('active with a published profile', () => {
    expect(describeMember({ ...base, status: 'ACTIVE', user })).toMatchObject({ accountStatus: 'active', profileStatus: 'published', position: 'Writer' })
  })

  it('active, profile incomplete (no bio) lists what is missing', () => {
    const row = describeMember({ ...base, status: 'ACTIVE', user: { ...user, teamProfile: { ...card, bio: null } } })
    expect(row).toMatchObject({ profileStatus: 'incomplete', missingFromMember: ['bio'] })
  })

  it('complete but hidden', () => {
    const row = describeMember({ ...base, status: 'ACTIVE', user: { ...user, teamProfile: { ...card, isActive: false } } })
    expect(row.profileStatus).toBe('hidden')
  })

  it('revoked, and suspended', () => {
    expect(describeMember({ ...base, status: 'REVOKED', user })).toMatchObject({ accountStatus: 'revoked' })
    expect(describeMember({ ...base, status: 'ACTIVE', user: { ...user, isBanned: true } })).toMatchObject({ accountStatus: 'suspended' })
  })

  it('shows the public position, never the permission role, for an admin', () => {
    const row = describeMember({
      ...base,
      status: 'ACTIVE',
      role: 'ADMIN',
      user: { ...user, role: 'ADMIN', teamProfile: { ...card, role: 'Deputy Editor', publicTier: 'leadership' } },
    })
    expect(row).toMatchObject({ role: 'ADMIN', position: 'Deputy Editor', tier: 'leadership' })
  })
})
