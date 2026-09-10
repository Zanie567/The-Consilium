import { describe, expect, it } from 'vitest'
import {
  buildTeamMasthead,
  hasDisplayableRole,
  resolveTeamTier,
  UNTITLED_MASTHEAD_MEMBERS,
  type TeamMemberLike,
} from '@/lib/teamHierarchy'

function member(name: string, role: string | null, order: number): TeamMemberLike {
  return { id: name.toLowerCase().replace(/\s+/g, '-'), name, role, order }
}

describe('resolveTeamTier', () => {
  it('maps the publication roles onto ordered tiers', () => {
    expect(resolveTeamTier('Editor-in-Chief')).toBe('editor_in_chief')
    expect(resolveTeamTier('Chief Designer')).toBe('leadership')
    expect(resolveTeamTier('Senior Editor')).toBe('senior_editor')
    expect(resolveTeamTier('Editor')).toBe('editor')
    expect(resolveTeamTier('Junior Editor')).toBe('junior_editor')
    expect(resolveTeamTier('Writer')).toBe('writer')
  })

  it('is insensitive to casing, punctuation and spacing', () => {
    expect(resolveTeamTier('  EDITOR IN CHIEF ')).toBe('editor_in_chief')
    expect(resolveTeamTier('editor–in–chief')).toBe('editor_in_chief')
    expect(resolveTeamTier('senior  editor')).toBe('senior_editor')
  })

  it('keeps deputy and acting titles out of the Editor-in-Chief slot', () => {
    expect(resolveTeamTier('Deputy Editor-in-Chief')).toBe('leadership')
    expect(resolveTeamTier('Acting Editor-in-Chief')).toBe('leadership')
  })

  it('places specialist leads and section editors sensibly', () => {
    expect(resolveTeamTier('Head of Design')).toBe('leadership')
    expect(resolveTeamTier('Creative Director')).toBe('leadership')
    expect(resolveTeamTier('Managing Editor')).toBe('editor')
    expect(resolveTeamTier('Copy Editor')).toBe('editor')
    expect(resolveTeamTier('Assistant Editor')).toBe('junior_editor')
    expect(resolveTeamTier('Contributing Writer')).toBe('writer')
    expect(resolveTeamTier('Columnist')).toBe('writer')
  })

  it('routes unrecognised roles to the wider-team tier instead of dropping them', () => {
    expect(resolveTeamTier('Social Media Manager')).toBe('other')
    expect(resolveTeamTier('Growth Lead')).toBe('other')
    expect(resolveTeamTier('Digital Operations')).toBe('other')
  })

  it('does not infer seniority for a missing role', () => {
    expect(resolveTeamTier(null)).toBe('other')
    expect(resolveTeamTier('')).toBe('other')
    expect(resolveTeamTier('   ')).toBe('other')
    expect(resolveTeamTier(undefined)).toBe('other')
  })
})

describe('hasDisplayableRole', () => {
  it('only accepts a role with visible characters', () => {
    expect(hasDisplayableRole('Writer')).toBe(true)
    expect(hasDisplayableRole('')).toBe(false)
    expect(hasDisplayableRole('  ')).toBe(false)
    expect(hasDisplayableRole(null)).toBe(false)
    expect(hasDisplayableRole(undefined)).toBe(false)
  })
})

describe('buildTeamMasthead', () => {
  const roster = [
    member('Alexander Escala', 'Editor-in-Chief', 1),
    member('Lucas Dwyer', '', 2),
    member('Satvik Singla', 'Senior Editor', 3),
    member('Julia Stepniak', 'Chief Designer', 4),
    member('Annika Sarawgi', 'Senior Editor', 5),
    member('Sam Hunt', 'Junior Editor', 6),
    member('Zara Spendiff', 'Writer', 7),
    member('Pat Ops', 'Social Media Manager', 8),
  ]

  it('builds masthead, editorial, writers and wider-team sections in order', () => {
    const sections = buildTeamMasthead(roster)
    expect(sections.map((s) => s.id)).toEqual(['masthead', 'editorial', 'writers', 'wider'])
    expect(sections[0].rows.map((r) => r.tier)).toEqual(['editor_in_chief', 'leadership'])
    expect(sections[1].rows.map((r) => r.tier)).toEqual(['senior_editor', 'junior_editor'])
  })

  it('puts the Editor-in-Chief alone at the top', () => {
    const [masthead] = buildTeamMasthead(roster)
    expect(masthead.rows[0].members.map((m) => m.name)).toEqual(['Alexander Escala'])
    expect(masthead.rows[0].variant).toBe('lead')
  })

  it('keeps the documented untitled leadership member in the masthead, after the titled leads', () => {
    const [masthead] = buildTeamMasthead(roster)
    expect(masthead.rows[1].tier).toBe('leadership')
    expect(masthead.rows[1].members.map((m) => m.name)).toEqual(['Julia Stepniak', 'Lucas Dwyer'])
    // ...and with no role of his own to display.
    const lucas = masthead.rows[1].members.find((m) => m.name === 'Lucas Dwyer')
    expect(hasDisplayableRole(lucas?.role)).toBe(false)
  })

  it('drops a generic untitled member to the wider team rather than the masthead', () => {
    const sections = buildTeamMasthead([
      member('Alexander Escala', 'Editor-in-Chief', 1),
      member('Newcomer Untitled', '', 2),
      member('Whitespace Untitled', '   ', 3),
      member('Null Untitled', null, 4),
    ])
    expect(sections.map((s) => s.id)).toEqual(['masthead', 'wider'])
    expect(sections[0].rows.map((r) => r.tier)).toEqual(['editor_in_chief'])
    const wider = sections[1]
    expect(wider.rows[0].tier).toBe('other')
    expect(wider.rows[0].members.map((m) => m.name)).toEqual([
      'Newcomer Untitled',
      'Whitespace Untitled',
      'Null Untitled',
    ])
  })

  it('applies the untitled-masthead exception by name, and only while the role is blank', () => {
    expect(UNTITLED_MASTHEAD_MEMBERS.has('lucas dwyer')).toBe(true)

    // Name matching tolerates casing and stray whitespace.
    const [masthead] = buildTeamMasthead([member('  LUCAS   DWYER ', '', 1)])
    expect(masthead.id).toBe('masthead')
    expect(masthead.rows[0].tier).toBe('leadership')

    // Give him a role again and the role alone decides the tier.
    const sections = buildTeamMasthead([member('Lucas Dwyer', 'Writer', 1)])
    expect(sections.map((s) => s.id)).toEqual(['writers'])
  })

  it('orders senior editors ahead of editors and junior editors', () => {
    const sections = buildTeamMasthead([
      member('Junior', 'Junior Editor', 1),
      member('Plain', 'Editor', 2),
      member('Senior', 'Senior Editor', 3),
    ])
    const editorial = sections.find((s) => s.id === 'editorial')
    expect(editorial?.rows.flatMap((r) => r.members.map((m) => m.name))).toEqual([
      'Senior',
      'Plain',
      'Junior',
    ])
  })

  it('displays only one Editor-in-Chief and demotes any extras to leadership', () => {
    const sections = buildTeamMasthead([
      member('Second Chief', 'Editor-in-Chief', 9),
      member('First Chief', 'Editor-in-Chief', 2),
    ])
    expect(sections[0].rows[0].members.map((m) => m.name)).toEqual(['First Chief'])
    expect(sections[0].rows[1].members.map((m) => m.name)).toEqual(['Second Chief'])
  })

  it('sorts each tier by display order, then name', () => {
    const writers = buildTeamMasthead([
      member('Bea', 'Writer', 5),
      member('Abe', 'Writer', 5),
      member('Cal', 'Writer', 1),
    ]).find((s) => s.id === 'writers')
    expect(writers?.rows[0].members.map((m) => m.name)).toEqual(['Cal', 'Abe', 'Bea'])
  })

  it('omits empty rows and sections', () => {
    const sections = buildTeamMasthead([member('Solo Writer', 'Writer', 1)])
    expect(sections.map((s) => s.id)).toEqual(['writers'])
    expect(sections[0].rows).toHaveLength(1)
  })

  it('returns nothing for an empty roster', () => {
    expect(buildTeamMasthead([])).toEqual([])
  })
})
