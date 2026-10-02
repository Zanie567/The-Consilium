import { describe, expect, it } from 'vitest'
import {
  TEAM_PROFILE_ROLES,
  buildPublicRoster,
  teamForRole,
  validateTeamBio,
  type TeamRowWithAccount,
} from '@/lib/teamProfiles'
import { buildTeamMasthead } from '@/lib/teamHierarchy'
import { ownedPhotoPath } from '@/lib/teamPhotoStorage'
import { detectImageMimeType } from '@/lib/imageSniff'

type Account = NonNullable<TeamRowWithAccount['user']>

function account(overrides: Partial<Account> = {}): Account {
  return {
    email: 'sam@ed.ac.uk',
    name: 'Sam Account',
    role: 'WRITER',
    bio: null,
    slug: 'sam-account',
    isActive: true,
    isBanned: false,
    ...overrides,
  }
}

function row(overrides: Partial<TeamRowWithAccount> = {}): TeamRowWithAccount {
  return {
    id: 'tm-1',
    name: 'Stored Name',
    role: '',
    bio: null,
    image: null,
    email: null,
    order: 1000,
    user: account(),
    ...overrides,
  }
}

describe('teamForRole — the fixed role → team mapping', () => {
  it('maps Writer → Writing, Editor → Editorial, Growth → Growth & Communications', () => {
    expect(teamForRole('WRITER')).toBe('writing')
    expect(teamForRole('EDITOR')).toBe('editorial')
    expect(teamForRole('GROWTH')).toBe('growth')
  })

  it.each(['ADMIN', 'READER', '', 'writer', '__proto__', 'constructor', null, undefined])(
    'gives %s no team',
    (role) => {
      expect(teamForRole(role as string)).toBeNull()
    },
  )

  it('is defined for exactly the roles allowed to own a profile', () => {
    expect([...TEAM_PROFILE_ROLES].sort()).toEqual(['EDITOR', 'GROWTH', 'WRITER'])
  })
})

describe('validateTeamBio', () => {
  it('trims, and treats blank as no bio', () => {
    expect(validateTeamBio('  hello  ', 600)).toEqual({ ok: true, bio: 'hello' })
    expect(validateTeamBio('   ', 600)).toEqual({ ok: true, bio: null })
    expect(validateTeamBio(undefined, 600)).toEqual({ ok: true, bio: null })
  })

  it('accepts exactly the limit and rejects one over', () => {
    expect(validateTeamBio('a'.repeat(600), 600).ok).toBe(true)
    expect(validateTeamBio('a'.repeat(601), 600).ok).toBe(false)
  })

  it('rejects a non-string', () => {
    expect(validateTeamBio(42, 600).ok).toBe(false)
    expect(validateTeamBio({ toString: () => 'x' }, 600).ok).toBe(false)
  })

  it('leaves markup as inert text for React to escape', () => {
    expect(validateTeamBio('<script>alert(1)</script>', 600)).toEqual({
      ok: true,
      bio: '<script>alert(1)</script>',
    })
  })
})

describe('buildPublicRoster', () => {
  it('derives each linked card’s team from the account role, not the stored row', () => {
    const roster = buildPublicRoster(
      [
        row({ id: 'w', user: account({ email: 'w@x', role: 'WRITER' }) }),
        row({ id: 'e', user: account({ email: 'e@x', role: 'EDITOR' }) }),
        row({ id: 'g', user: account({ email: 'g@x', role: 'GROWTH' }) }),
      ],
      [],
    )
    expect(Object.fromEntries(roster.map((m) => [m.id, m.team]))).toEqual({
      w: 'writing',
      e: 'editorial',
      g: 'growth',
    })
  })

  it('takes the name from the account and falls back to the stored one', () => {
    const [renamed] = buildPublicRoster([row({ user: account({ name: ' New Name ' }) })], [])
    const [unnamed] = buildPublicRoster([row({ user: account({ name: null }) })], [])
    expect(renamed.name).toBe('New Name')
    expect(unnamed.name).toBe('Stored Name')
  })

  it('prefers the card bio, then the account bio', () => {
    const [own] = buildPublicRoster([row({ bio: 'Card bio', user: account({ bio: 'Acct bio' }) })], [])
    const [fallback] = buildPublicRoster([row({ bio: null, user: account({ bio: 'Acct bio' }) })], [])
    expect(own.bio).toBe('Card bio')
    expect(fallback.bio).toBe('Acct bio')
  })

  it('hides cards whose account is banned, inactive, or no longer on a team', () => {
    const roster = buildPublicRoster(
      [
        row({ id: 'banned', user: account({ email: 'a@x', isBanned: true }) }),
        row({ id: 'inactive', user: account({ email: 'b@x', isActive: false }) }),
        row({ id: 'demoted', user: account({ email: 'c@x', role: 'READER' }) }),
        row({ id: 'ok', user: account({ email: 'd@x' }) }),
      ],
      [],
    )
    expect(roster.map((m) => m.id)).toEqual(['ok'])
  })

  it('shows no linked card for an account without a team role, whatever the card title says', () => {
    for (const role of ['ADMIN', 'READER']) {
      expect(buildPublicRoster([row({ role: 'Editor-in-Chief', user: account({ role }) })], [])).toEqual([])
    }
  })

  it('keeps the card title for display but derives the team from the role alone', () => {
    const [m] = buildPublicRoster([row({ role: 'Editor-in-Chief', user: account({ role: 'WRITER' }) })], [])
    expect(m).toMatchObject({ role: 'Editor-in-Chief', team: 'writing' })
  })

  it('drops a legacy card whose email already belongs to a linked card (no duplicate person)', () => {
    const roster = buildPublicRoster(
      [
        row({ id: 'linked', user: account({ email: 'Sam@ed.ac.uk' }) }),
        row({ id: 'legacy', email: 'sam@ED.ac.uk', user: null }),
        row({ id: 'other-legacy', email: 'kim@ed.ac.uk', user: null }),
      ],
      [],
    )
    expect(roster.map((m) => m.id).sort()).toEqual(['linked', 'other-legacy'])
  })

  it('still resolves legacy bios from a matching account by email', () => {
    const [legacy] = buildPublicRoster(
      [row({ user: null, email: 'kim@ed.ac.uk', bio: 'Admin bio' })],
      [{ email: 'KIM@ed.ac.uk', bio: 'Own bio', slug: 'kim' }],
    )
    expect(legacy.bio).toBe('Own bio')
    expect(legacy.team).toBeNull()
  })
})

describe('masthead sections for account-linked cards', () => {
  const sectionOf = (member: Parameters<typeof buildTeamMasthead>[0][number]) =>
    buildTeamMasthead([member])[0].id

  const base = { id: 'm', name: 'M', order: 1 }
  const TEAM_SECTION = { writing: 'writers', editorial: 'editorial', growth: 'growth' } as const

  it('NO title can move a linked card out of its team — checked for every title and team', () => {
    const titles = [
      'Editor-in-Chief', 'Deputy Editor-in-Chief', 'Chief Designer', 'Head of Growth', 'Creative Director',
      'Senior Editor', 'Junior Editor', 'Editor', 'Writer', 'Senior Writer', 'Social Media Manager',
      'Treasurer', 'Former Editor-in-Chief', '', null, 'EDITOR-IN-CHIEF', 'editor in chief',
    ]
    for (const team of ['writing', 'editorial', 'growth'] as const) {
      for (const role of titles) {
        for (const name of ['M', 'Lucas Dwyer']) {
          expect(sectionOf({ ...base, name, role, team }), `${team} / ${role} / ${name}`).toBe(TEAM_SECTION[team])
        }
      }
    }
  })

  it('an Editor-in-Chief on a WRITER account is a Writer, not a masthead leader', () => {
    const [section] = buildTeamMasthead([{ ...base, role: 'Editor-in-Chief', team: 'writing' }])
    expect(section.id).toBe('writers')
    expect(section.rows[0].tier).toBe('writer')
  })

  it('an Editor-in-Chief on an EDITOR account leads the Editorial section', () => {
    const sections = buildTeamMasthead([
      { id: 'a', name: 'A', order: 5, role: 'Senior Editor', team: 'editorial' },
      { id: 'c', name: 'C', order: 1, role: 'Editor-in-Chief', team: 'editorial' },
      { id: 'd', name: 'D', order: 3, role: 'Chief Designer', team: 'editorial' },
    ])
    expect(sections.map((s) => s.id)).toEqual(['editorial'])
    expect(sections[0].rows.map((r) => [r.tier, r.variant, r.members[0].id])).toEqual([
      ['editor_in_chief', 'lead', 'c'],
      ['leadership', 'feature', 'd'],
      ['senior_editor', 'standard', 'a'],
    ])
  })

  it('shows one Editor-in-Chief; any further one drops to leadership within the same team', () => {
    const sections = buildTeamMasthead([
      { id: 'x', name: 'X', order: 2, role: 'Editor-in-Chief', team: 'editorial' },
      { id: 'y', name: 'Y', order: 1, role: 'Editor-in-Chief', team: 'editorial' },
    ])
    expect(sections[0].rows.map((r) => [r.tier, r.members[0].id])).toEqual([
      ['editor_in_chief', 'y'],
      ['leadership', 'x'],
    ])
  })

  it('keeps order and seniority tier among linked editors, and ignores a non-editorial title', () => {
    const sections = buildTeamMasthead([
      { id: 'j', name: 'Sam', order: 6, role: 'Junior Editor', team: 'editorial' },
      { id: 's', name: 'Ann', order: 5, role: 'Senior Editor', team: 'editorial' },
      { id: 'w', name: 'Wes', order: 7, role: 'Writer', team: 'editorial' },
    ])
    expect(sections[0].rows.map((r) => [r.tier, r.members[0].id])).toEqual([
      ['senior_editor', 's'],
      ['editor', 'w'],
      ['junior_editor', 'j'],
    ])
  })

  it('renders a Growth & Communications section, after Writers and before Wider Team', () => {
    const sections = buildTeamMasthead([
      { id: '1', name: 'A', order: 1, role: 'Social Media', team: 'growth' },
      { id: '2', name: 'B', order: 2, role: '', team: 'growth' },
      { id: '3', name: 'C', order: 3, role: 'Writer', team: 'writing' },
      { id: '4', name: 'D', order: 4, role: 'Treasurer', team: null },
    ])
    expect(sections.map((s) => s.id)).toEqual(['writers', 'growth', 'wider'])
    expect(sections[1].label).toBe('Growth & Communications')
    expect(sections[1].rows[0].members.map((m) => m.id)).toEqual(['1', '2'])
  })

  it('omits the Growth section when nobody is in it', () => {
    expect(buildTeamMasthead([{ ...base, role: 'Writer', team: 'writing' }]).map((s) => s.id)).toEqual(['writers'])
  })

  it('leaves legacy cards (no linked account) exactly where their titles put them', () => {
    expect(sectionOf({ ...base, role: 'Senior Editor' })).toBe('editorial')
    expect(sectionOf({ ...base, role: 'Writer' })).toBe('writers')
    expect(sectionOf({ ...base, role: 'Chief Designer' })).toBe('masthead')
    expect(sectionOf({ ...base, role: 'Editor-in-Chief' })).toBe('masthead')
    expect(sectionOf({ ...base, role: 'Growth Lead' })).toBe('wider')
    expect(sectionOf({ ...base, name: 'Lucas Dwyer', role: '' })).toBe('masthead')
  })
})

describe('ownedPhotoPath', () => {
  const BASE = 'https://proj.supabase.co'
  const url = (path: string) => `${BASE}/storage/v1/object/public/avatars/${path}`

  it('returns the path only for a file in the user’s own folder', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE
    expect(ownedPhotoPath(url('u1/team-1.png'), 'u1')).toBe('u1/team-1.png')
    expect(ownedPhotoPath(url('u2/team-1.png'), 'u1')).toBeNull()
    expect(ownedPhotoPath(url('u1/../u2/x.png'), 'u1')).toBeNull()
    expect(ownedPhotoPath(url('u1/sub/x.png'), 'u1')).toBeNull()
    expect(ownedPhotoPath(url('u1/'), 'u1')).toBeNull()
    expect(ownedPhotoPath('/team/sam-hunt.png', 'u1')).toBeNull()
    expect(ownedPhotoPath(null, 'u1')).toBeNull()
    // a sibling user whose id merely starts with ours
    expect(ownedPhotoPath(url('u10/x.png'), 'u1')).toBeNull()
  })
})

describe('detectImageMimeType', () => {
  it('recognises real image headers and rejects everything else', () => {
    expect(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectImageMimeType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(detectImageMimeType(new TextEncoder().encode('<?php echo 1;'))).toBeNull()
    expect(detectImageMimeType(new Uint8Array([]))).toBeNull()
  })
})
