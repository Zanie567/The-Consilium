import { describe, expect, it } from 'vitest'
import {
  attachAuthorPages,
  authorPageHref,
  buildPublicRoster,
  rosterAuthorIds,
  type LinkedAccount,
  type TeamRowWithAccount,
} from '@/lib/teamProfiles'
import { buildTeamMasthead } from '@/lib/teamHierarchy'

// "Read their articles" follows published authorship only. Which accounts have published
// is decided by the database (see tests/integration/team-author-links-db.test.ts); here the
// set of published account ids is given, and the attribution and link rules are checked.

type Account = NonNullable<TeamRowWithAccount['user']>

let n = 0
function linked(card: Partial<TeamRowWithAccount>, user: Partial<Account> = {}): TeamRowWithAccount {
  n++
  return {
    id: `card-${n}`, name: `Person ${n}`, role: 'Writer', bio: 'A short bio.', image: null, email: null,
    order: n, publicTier: null, isActive: true,
    user: { id: `user-${n}`, email: `person${n}@ed.ac.uk`, name: `Person ${n}`, role: 'WRITER', displayTitles: [],
      bio: null, slug: `person-${n}`, isActive: true, isBanned: false, ...user },
    ...card,
  }
}
function legacy(card: Partial<TeamRowWithAccount>): TeamRowWithAccount {
  n++
  return { id: `legacy-${n}`, name: `Legacy ${n}`, role: 'Writer', bio: 'Admin bio.', image: null, email: null,
    order: n, publicTier: null, isActive: true, user: null, ...card }
}
const account = (fields: Partial<LinkedAccount> & { email: string }): LinkedAccount =>
  ({ id: `acct-${fields.email}`, bio: null, slug: null, ...fields })

/** The public roster, as `loadPublicTeam` builds it, given which accounts have published. */
function publish(rows: TeamRowWithAccount[], published: string[], accounts: LinkedAccount[] = []) {
  return attachAuthorPages(buildPublicRoster(rows, accounts), new Set(published))
}
const pageOf = (roster: ReturnType<typeof publish>, id: string) => roster.find((m) => m.id === id)?.authorPage

describe('Read their articles: published authorship, not position', () => {
  const positions = [
    { title: 'Writer', tier: 'writer', permission: 'WRITER' },
    { title: 'Editor', tier: 'editor', permission: 'EDITOR' },
    { title: 'Senior Editor', tier: 'senior_editor', permission: 'EDITOR' },
    { title: 'Editor-in-Chief', tier: 'editor_in_chief', permission: 'ADMIN' },
    { title: 'Deputy Editor-in-Chief', tier: 'deputy', permission: 'ADMIN' },
    { title: 'Growth & Communications', tier: 'growth', permission: 'GROWTH' },
    // A demoted account keeps its card (access and the card are separate) and its byline.
    { title: 'Writer', tier: 'writer', permission: 'READER' },
  ]

  it.each(positions)('$title ($permission) with a published article gets the link', ({ title, tier, permission }) => {
    const row = linked({ role: title, publicTier: tier }, { role: permission, slug: 'a-person' })
    expect(pageOf(publish([row], [row.user!.id]), row.id)).toBe('/author/a-person')
  })

  it.each(positions)('$title ($permission) without a published article gets none', ({ title, tier, permission }) => {
    const row = linked({ role: title, publicTier: tier }, { role: permission })
    expect(pageOf(publish([row], []), row.id)).toBeNull()
  })

  it('keeps the link wherever the masthead places the card', () => {
    const rows = [
      linked({ role: 'Editor-in-Chief', publicTier: 'editor_in_chief', order: 1 }, { role: 'ADMIN' }),
      linked({ role: 'Junior Editor', publicTier: 'junior_editor', order: 50 }, { role: 'EDITOR' }),
      linked({ role: 'Growth & Comms', publicTier: 'growth', order: 99 }, { role: 'GROWTH' }),
      linked({ role: 'Writer', publicTier: null, order: 1000 }, { role: 'WRITER' }),
    ]
    const sections = buildTeamMasthead(publish(rows, rows.map((r) => r.user!.id)))
    const shown = sections.flatMap((s) => s.rows.flatMap((r) => r.members))
    expect(shown).toHaveLength(4)
    for (const member of shown) expect(member.authorPage).toMatch(/^\/author\/person-\d+$/)
  })

  it('links by account id when the account has no slug', () => {
    const row = linked({}, { id: 'cm9user123', slug: null })
    expect(pageOf(publish([row], ['cm9user123']), row.id)).toBe('/author/cm9user123')
  })

  it('treats an empty slug as missing', () => {
    expect(authorPageHref({ id: 'cm9user123', slug: '' })).toBe('/author/cm9user123')
  })

  it('never puts an unpublished author’s account id on the public roster', () => {
    const row = linked({}, { id: 'secret-account-id', slug: null })
    const [member] = publish([row], [])
    expect(JSON.stringify(member)).not.toContain('secret-account-id')
    expect(member).not.toHaveProperty('author')
  })

  it('does not publish a hidden card because its owner has published', () => {
    const hidden = linked({ isActive: false })
    const incomplete = linked({ bio: null })
    expect(publish([hidden, incomplete], [hidden.user!.id, incomplete.user!.id])).toEqual([])
  })

  it('asks the database about each attributed account once', () => {
    const a = linked({})
    const b = linked({})
    const roster = buildPublicRoster(
      [a, b, legacy({ email: 'kim@ed.ac.uk' }), legacy({ email: null })],
      [account({ email: 'kim@ed.ac.uk', id: 'kim' })],
    )
    expect(rosterAuthorIds(roster).sort()).toEqual([a.user!.id, b.user!.id, 'kim'].sort())
  })
})

describe('legacy (unlinked) cards', () => {
  it('links through an unambiguous email match to an account', () => {
    const card = legacy({ email: 'Kim@ED.ac.uk' })
    const roster = publish([card], ['kim'], [account({ email: 'kim@ed.ac.uk', id: 'kim', slug: 'kim-lee' })])
    expect(pageOf(roster, card.id)).toBe('/author/kim-lee')
  })

  it('attributes nothing when two accounts share the address in different case', () => {
    const card = legacy({ email: 'kim@ed.ac.uk' })
    const accounts = [account({ email: 'Kim@ed.ac.uk', id: 'kim-1' }), account({ email: 'kim@ED.ac.uk', id: 'kim-2' })]
    expect(pageOf(publish([card], ['kim-1', 'kim-2'], accounts), card.id)).toBeNull()
  })

  it('attributes nothing when two cards share one address', () => {
    const first = legacy({ email: 'editors@ed.ac.uk' })
    const second = legacy({ email: 'Editors@ed.ac.uk' })
    const roster = publish([first, second], ['shared'], [account({ email: 'editors@ed.ac.uk', id: 'shared' })])
    expect(pageOf(roster, first.id)).toBeNull()
    expect(pageOf(roster, second.id)).toBeNull()
  })

  it('never matches on name: a card without an email gets no link', () => {
    const card = legacy({ name: 'Kim Lee', email: null })
    const roster = publish([card], ['kim'], [account({ email: 'kim@ed.ac.uk', id: 'kim', slug: 'kim-lee' })])
    expect(pageOf(roster, card.id)).toBeNull()
  })

  it('gets no link when no account matches', () => {
    const card = legacy({ email: 'nobody@ed.ac.uk' })
    expect(pageOf(publish([card], ['anyone']), card.id)).toBeNull()
  })
})
