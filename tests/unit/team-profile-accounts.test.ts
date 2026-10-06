import { describe, expect, it } from 'vitest'
import {
  TEAM_PROFILE_ROLES,
  buildPublicRoster,
  teamForRole,
  validateTeamBio,
  visiblePublicAppointmentLabel,
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
    role: 'Writer',
    // A linked card is public only with a title and a description, so the default row is a
    // ready one and each test varies a single thing.
    bio: 'A short bio.',
    image: null,
    email: null,
    order: 1000,
    user: account(),
    ...overrides,
  }
}

describe('teamForRole — ordinary creation defaults only', () => {
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

  it('allows ADMIN ownership without granting an automatic public appointment', () => {
    expect([...TEAM_PROFILE_ROLES].sort()).toEqual(['ADMIN', 'EDITOR', 'GROWTH', 'WRITER'])
  })
})

describe('public author appointment labels', () => {
  it.each(['ADMIN', 'WRITER', 'EDITOR', 'GROWTH'])('keeps the assigned chief title with %s website permissions', role => {
    const author = { ...account({ role }), teamProfile: { role: 'Editor-in-Chief', publicTier: null, isActive: true } }
    expect(visiblePublicAppointmentLabel(author)).toBe('Editor-in-Chief')
    expect(visiblePublicAppointmentLabel({ ...author, teamProfile: { role: 'Chief Designer', isActive: true } })).toBe('Chief Designer')
  })

  it('does not confer public leadership from ADMIN permission or a user-edited name', () => {
    expect(visiblePublicAppointmentLabel({ ...account({ role: 'ADMIN', name: 'Editor-in-Chief' }), teamProfile: null })).toBeNull()
  })

  it('respects public visibility, account suspension and bans', () => {
    const author = { ...account(), teamProfile: { role: 'Editor-in-Chief', isActive: true } }
    expect(visiblePublicAppointmentLabel({ ...author, isActive: false })).toBeNull()
    expect(visiblePublicAppointmentLabel({ ...author, isBanned: true })).toBeNull()
    expect(visiblePublicAppointmentLabel({ ...author, teamProfile: { ...author.teamProfile, isActive: false } })).toBeNull()
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
  it('does not derive placement from any account permission', () => {
    for (const role of ['ADMIN', 'WRITER', 'EDITOR', 'GROWTH']) {
      const roster = buildPublicRoster([row({ role: 'Editor-in-Chief', order: 1, user: account({ role }) })], [])
      const sections = buildTeamMasthead(roster)
      expect(sections[0].id).toBe('masthead')
      expect(sections[0].rows[0]).toMatchObject({ tier: 'editor_in_chief', variant: 'lead' })
      expect(sections.flatMap(s => s.rows.flatMap(r => r.members)).map(m => m.id)).toEqual(['tm-1'])
    }
  })

  it('uses the card’s own display name, falling back to the account name', () => {
    const [own] = buildPublicRoster([row({ name: ' Preferred Name ', user: account({ name: 'Account Name' }) })], [])
    const [fallback] = buildPublicRoster([row({ name: '  ', user: account({ name: ' Account Name ' }) })], [])
    expect(own.name).toBe('Preferred Name')
    expect(fallback.name).toBe('Account Name')
  })

  it('never shows a linked card without a description, title or any name', () => {
    const roster = buildPublicRoster(
      [
        row({ id: 'no-bio', bio: null, user: account({ email: 'a@x', bio: 'The account bio is not used' }) }),
        row({ id: 'blank-bio', bio: '   ', user: account({ email: 'b@x' }) }),
        row({ id: 'no-title', role: '  ', user: account({ email: 'c@x' }) }),
        row({ id: 'no-name', name: '', user: account({ email: 'd@x', name: null }) }),
        row({ id: 'ok', user: account({ email: 'e@x' }) }),
      ],
      [],
    )
    expect(roster.map((m) => m.id)).toEqual(['ok'])
  })

  it('hides cards whose account is banned or inactive', () => {
    const roster = buildPublicRoster(
      [
        row({ id: 'banned', user: account({ email: 'a@x', isBanned: true }) }),
        row({ id: 'inactive', user: account({ email: 'b@x', isActive: false }) }),
        row({ id: 'demoted', user: account({ email: 'c@x', role: 'READER' }) }),
        row({ id: 'ok', user: account({ email: 'd@x' }) }),
      ],
      [],
    )
    expect(roster.map((m) => m.id)).toEqual(['demoted', 'ok']) // access and the public card are separate
  })

  it('keeps the title and appointment for ADMIN and READER without assigning privileges', () => {
    for (const role of ['ADMIN', 'READER']) {
      expect(buildPublicRoster([row({ role: 'Editor-in-Chief', user: account({ role }) })], [])[0]).toMatchObject({ role: 'Editor-in-Chief', team: null })
    }
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

describe('explicit public appointments', () => {
  it('allows only trusted appointment data to change placement', () => {
    const base = { id: 'm', name: 'Lucas Dwyer', order: 1, role: '' }
    expect(buildTeamMasthead([base])[0].id).toBe('wider')
    expect(buildTeamMasthead([{ ...base, publicTier: 'leadership' }])[0].rows[0].variant).toBe('feature')
    expect(buildTeamMasthead([{ ...base, role: 'Writer' }])[0].id).toBe('writers')
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
