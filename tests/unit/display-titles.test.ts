import { describe, it, expect } from 'vitest'
import {
  ALLOWED_DISPLAY_TITLES,
  permissionRoleLabel,
  readDisplayTitles,
  resolvePublicTitleLabel,
  validateDisplayTitles,
} from '@/lib/displayTitles'
import { visiblePublicTitleLabel } from '@/lib/teamProfiles'

describe('validateDisplayTitles', () => {
  it('accepts any combination of up to four allowed titles', () => {
    expect(validateDisplayTitles(['Deputy Editor-in-Chief', 'Writer']).ok).toBe(true)
    expect(validateDisplayTitles([]).ok).toBe(true)
    expect(validateDisplayTitles([...ALLOWED_DISPLAY_TITLES].slice(0, 4)).ok).toBe(true)
  })

  it('excludes the masthead tiers, which are not titles', () => {
    expect(validateDisplayTitles(['Leadership']).ok).toBe(false)
    expect(validateDisplayTitles(['Wider Team']).ok).toBe(false)
  })

  it('rejects free text, duplicates, a fifth title and the wrong type', () => {
    expect(validateDisplayTitles(['Supreme Leader']).ok).toBe(false)
    expect(validateDisplayTitles(['Writer', 'Writer']).ok).toBe(false)
    expect(validateDisplayTitles([...ALLOWED_DISPLAY_TITLES].slice(0, 5)).ok).toBe(false)
    expect(validateDisplayTitles('Writer').ok).toBe(false)
    expect(validateDisplayTitles(null).ok).toBe(false)
  })
})

describe('readDisplayTitles', () => {
  it('drops anything that is not an allowed, distinct title', () => {
    expect(readDisplayTitles(['Writer', 'Nope', 'Writer', 7])).toEqual(['Writer'])
    expect(readDisplayTitles(undefined)).toEqual([])
  })
})

describe('resolvePublicTitleLabel', () => {
  it('prefers display titles, then the card title, then the role label', () => {
    expect(
      resolvePublicTitleLabel({ displayTitles: ['Deputy Editor-in-Chief', 'Writer'], cardTitle: 'Chief Designer', role: 'WRITER' }),
    ).toBe('Deputy Editor-in-Chief · Writer')
    expect(resolvePublicTitleLabel({ displayTitles: [], cardTitle: 'Chief Designer', role: 'WRITER' })).toBe('Chief Designer')
    expect(resolvePublicTitleLabel({ displayTitles: [], cardTitle: null, role: 'WRITER' })).toBe('Writer')
  })

  it('never names Administrator or Reader publicly', () => {
    expect(permissionRoleLabel('ADMIN')).toBeNull()
    expect(permissionRoleLabel('READER')).toBeNull()
    expect(resolvePublicTitleLabel({ displayTitles: [], role: 'ADMIN' })).toBeNull()
  })

  it('contains no em dash', () => {
    expect(resolvePublicTitleLabel({ displayTitles: ['Editor', 'Writer'] })).not.toMatch(new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']'))
  })
})

describe('visiblePublicTitleLabel', () => {
  const base = { isActive: true, isBanned: false, role: 'WRITER', displayTitles: [] as string[], teamProfile: null }

  it('keeps the old card label for users with no titles', () => {
    expect(visiblePublicTitleLabel({ ...base, teamProfile: { role: 'Senior Editor', isActive: true } })).toBe('Senior Editor')
  })

  it('falls back to the role label, and to null for an admin with nothing set', () => {
    expect(visiblePublicTitleLabel(base)).toBe('Writer')
    expect(visiblePublicTitleLabel({ ...base, role: 'ADMIN' })).toBeNull()
  })

  it('shows titles even when the card is inactive, but ignores the inactive card title', () => {
    const inactive = { role: 'Chief Designer', isActive: false }
    expect(visiblePublicTitleLabel({ ...base, teamProfile: inactive, displayTitles: ['Editor'] })).toBe('Editor')
    expect(visiblePublicTitleLabel({ ...base, teamProfile: inactive })).toBe('Writer')
  })

  it('shows nothing for a banned or deactivated account', () => {
    expect(visiblePublicTitleLabel({ ...base, isBanned: true, displayTitles: ['Editor'] })).toBeNull()
    expect(visiblePublicTitleLabel({ ...base, isActive: false, displayTitles: ['Editor'] })).toBeNull()
  })
})
