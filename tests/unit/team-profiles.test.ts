import { describe, expect, it } from 'vitest'
import {
  resolveTeamMemberBios,
  teamMemberEmails,
  type LinkedAccount,
  type TeamMemberRow,
} from '@/lib/teamProfiles'

function teamMember(overrides: Partial<TeamMemberRow> = {}): TeamMemberRow {
  return {
    id: 'tm-1',
    name: 'Alex Morgan',
    role: 'Editor',
    bio: 'Admin-entered bio.',
    image: null,
    email: 'alex@ed.ac.uk',
    order: 0,
    ...overrides,
  }
}

function account(overrides: Partial<LinkedAccount> = {}): LinkedAccount {
  return { email: 'alex@ed.ac.uk', bio: 'My own bio.', slug: 'alex-morgan', ...overrides }
}

describe('teamMemberEmails', () => {
  it('lower-cases, de-duplicates and drops members with no email', () => {
    const emails = teamMemberEmails([
      teamMember({ id: 'a', email: 'Alex@ED.ac.uk' }),
      teamMember({ id: 'b', email: 'alex@ed.ac.uk' }),
      teamMember({ id: 'c', email: null }),
      teamMember({ id: 'd', email: '  ' }),
    ])
    expect(emails).toEqual(['alex@ed.ac.uk'])
  })
})

describe('resolveTeamMemberBios', () => {
  it("prefers the person's own account bio over the admin-entered one", () => {
    const [resolved] = resolveTeamMemberBios([teamMember()], [account()])
    expect(resolved.bio).toBe('My own bio.')
    expect(resolved.authorSlug).toBe('alex-morgan')
  })

  it('matches emails case-insensitively', () => {
    const [resolved] = resolveTeamMemberBios(
      [teamMember({ email: 'Alex@ED.ac.uk' })],
      [account({ email: 'alex@ed.ac.uk' })],
    )
    expect(resolved.bio).toBe('My own bio.')
  })

  it('keeps the admin bio when the member has no account', () => {
    const [resolved] = resolveTeamMemberBios([teamMember()], [])
    expect(resolved.bio).toBe('Admin-entered bio.')
    expect(resolved.authorSlug).toBeNull()
  })

  it('keeps the admin bio when the account bio is empty or blank', () => {
    const [blank] = resolveTeamMemberBios([teamMember()], [account({ bio: '   ' })])
    expect(blank.bio).toBe('Admin-entered bio.')

    const [missing] = resolveTeamMemberBios([teamMember()], [account({ bio: null })])
    expect(missing.bio).toBe('Admin-entered bio.')
  })

  it('still links the author page when the account bio is empty', () => {
    const [resolved] = resolveTeamMemberBios([teamMember()], [account({ bio: null })])
    expect(resolved.authorSlug).toBe('alex-morgan')
  })

  it('leaves a member with neither bio empty rather than inventing text', () => {
    const [resolved] = resolveTeamMemberBios([teamMember({ bio: null })], [])
    expect(resolved.bio).toBeNull()
  })

  it('preserves the fields the masthead needs to tier and render', () => {
    const [resolved] = resolveTeamMemberBios(
      [teamMember({ order: 3, image: '/x.png', role: 'Senior Editor' })],
      [],
    )
    expect(resolved).toMatchObject({
      id: 'tm-1',
      name: 'Alex Morgan',
      role: 'Senior Editor',
      order: 3,
      image: '/x.png',
    })
  })
})
