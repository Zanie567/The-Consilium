import { describe, it, expect } from 'vitest'
import { assessPublication, isPlaceholderBio, publicationBlockers, publicationSummary } from '@/lib/teamVisibility'
import { buildPublicRoster, type TeamRowWithAccount } from '@/lib/teamProfiles'

const account = { name: 'Kai Writer', email: 'kai@ed.ac.uk', isActive: true, isBanned: false }
const card = { name: 'Kai Writer', position: 'Writer', bio: 'Second-year economist.', image: null, visible: true }

describe('assessPublication', () => {
  it('a complete, switched-on card of an active account is published; a photo is optional', () => {
    expect(assessPublication(card, account)).toMatchObject({ status: 'published', onPublicPage: true, canPublish: true, blockers: [], notes: ['no-photo'] })
  })

  it('a complete card that is switched off is hidden and may be published', () => {
    const a = assessPublication({ ...card, visible: false }, account)
    expect(a).toMatchObject({ status: 'hidden', onPublicPage: false, canPublish: true, blockers: [] })
    expect(publicationSummary(a)).toMatch(/until an administrator publishes it/)
  })

  it('names every missing required field, and refuses publication', () => {
    const a = assessPublication({ ...card, name: '', position: ' ', bio: null, visible: false }, { ...account, name: null })
    expect(a).toMatchObject({ status: 'incomplete', canPublish: false, blockers: ['name', 'position', 'bio'] })
  })

  it('a linked card falls back to the account name, as the public page does', () => {
    expect(publicationBlockers({ ...card, name: '' }, account)).toEqual([])
  })

  it('a switched-on card is still held back when incomplete, and says so', () => {
    const a = assessPublication({ ...card, bio: '' }, account)
    expect(a).toMatchObject({ status: 'incomplete', visible: true, onPublicPage: false })
    expect(publicationSummary(a)).toMatch(/held back/)
  })

  it('suspended, deactivated and test accounts are not eligible, whatever the switch says', () => {
    expect(assessPublication(card, { ...account, isBanned: true })).toMatchObject({ status: 'ineligible', onPublicPage: false, canPublish: false, blockers: ['account-suspended'] })
    expect(assessPublication(card, { ...account, isActive: false })).toMatchObject({ status: 'ineligible', blockers: ['account-inactive'] })
    expect(assessPublication(card, { ...account, email: 'test-kai@ed.ac.uk' })).toMatchObject({ status: 'ineligible', blockers: ['test-account'] })
    expect(assessPublication(card, { ...account, email: 'test-kai@ed.ac.uk' }, { testingMode: true }).status).toBe('published')
  })

  it('a legacy card (no account) keeps its historical behaviour: the switch alone decides', () => {
    expect(assessPublication({ ...card, bio: null }, null)).toMatchObject({ status: 'published', onPublicPage: true, blockers: [], notes: ['no-photo', 'legacy-incomplete'] })
    expect(assessPublication({ ...card, bio: null, visible: false }, null)).toMatchObject({ status: 'incomplete', canPublish: false, blockers: ['bio'] })
  })

  it('placeholder biographies are a note, never a reason to hide a published card', () => {
    const a = assessPublication({ ...card, bio: 'Bio to be added.' }, account)
    expect(a).toMatchObject({ status: 'published', onPublicPage: true, canPublish: true })
    expect(a.notes).toContain('placeholder-bio')
  })
})

describe('isPlaceholderBio', () => {
  it.each(['Bio to be added', 'bio to be added.', 'Biography: TBC', 'Coming soon!', 'TBD', 'to be added soon', 'Lorem ipsum dolor sit amet', 'Add bio here', 'Bio - to follow'])(
    'flags %j', (bio) => expect(isPlaceholderBio(bio)).toBe(true),
  )
  it.each([null, '', 'Writes about monetary policy. Exchange column coming soon.', 'Kai studies economics and is to be added to the board.', 'TBC member of the Economics Society'])(
    'does not flag %j', (bio) => expect(isPlaceholderBio(bio)).toBe(false),
  )
})

// The admin explanation and the public page must agree on every linked card.
describe('parity with the public roster', () => {
  const variants: { name: string; role: string; bio: string | null; isActive: boolean; user: TeamRowWithAccount['user'] }[] = []
  for (const name of ['Kai Writer', '']) for (const role of ['Writer', '']) for (const bio of ['A bio.', null]) for (const isActive of [true, false])
    for (const u of [{ isActive: true, isBanned: false, email: 'kai@ed.ac.uk' }, { isActive: false, isBanned: false, email: 'kai@ed.ac.uk' }, { isActive: true, isBanned: true, email: 'kai@ed.ac.uk' }, { isActive: true, isBanned: false, email: 'test-kai@ed.ac.uk' }])
      for (const accountName of ['Kai', null])
        variants.push({ name, role, bio, isActive, user: { ...u, name: accountName, role: 'WRITER', bio: null, slug: null } })

  it.each(variants.map((v, i) => [i, v] as const))('variant %i', (_i, v) => {
    const row: TeamRowWithAccount = { id: 'c1', name: v.name, role: v.role, bio: v.bio, image: null, email: null, order: 1, publicTier: null, isActive: v.isActive, user: v.user }
    const shown = buildPublicRoster([row], []).length === 1
    const assessed = assessPublication({ name: v.name, position: v.role, bio: v.bio, image: null, visible: v.isActive }, v.user)
    expect(assessed.onPublicPage).toBe(shown)
  })
})
