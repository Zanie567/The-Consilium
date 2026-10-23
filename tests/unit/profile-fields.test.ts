import { describe, it, expect } from 'vitest'
import {
  cardFollowsAccount,
  normalizeShared,
  previewPublicProfile,
  profileEditorState,
  sharedProfileView,
  type SharedValues,
} from '@/lib/profileFields'
import { visibleAuthorProfile } from '@/lib/teamProfiles'

const account = (over: Partial<SharedValues> = {}): SharedValues => ({ name: 'Ada Lovelace', bio: 'Account bio.', image: 'https://x/acct.png', ...over })
const card = (over: Partial<SharedValues> = {}): SharedValues => ({ name: 'Ada Lovelace', bio: 'Card bio.', image: 'https://x/card.png', ...over })
const facts = { isActive: true, positionLabel: 'Writer', blockedRegardless: false }

describe('normalizeShared', () => {
  it('treats blank and missing as no value, and trims', () => {
    expect(normalizeShared('  ')).toBeNull()
    expect(normalizeShared(undefined)).toBeNull()
    expect(normalizeShared(' a ')).toBe('a')
  })
})

describe('cardFollowsAccount', () => {
  it('keeps a staff member’s own card in step, and never a reader’s', () => {
    for (const role of ['WRITER', 'EDITOR', 'GROWTH', 'ADMIN']) {
      expect(cardFollowsAccount({ role, hasCard: true, byAdministrator: false })).toBe(true)
    }
    expect(cardFollowsAccount({ role: 'READER', hasCard: true, byAdministrator: false })).toBe(false)
    expect(cardFollowsAccount({ role: 'WRITER', hasCard: false, byAdministrator: false })).toBe(false)
  })

  it('an administrator editing a linked person always keeps the card in step', () => {
    expect(cardFollowsAccount({ role: 'READER', hasCard: true, byAdministrator: true })).toBe(true)
  })
})

describe('sharedProfileView', () => {
  it('shows the card for a linked contributor and lists only what the account holds differently', () => {
    const view = sharedProfileView(account({ name: 'Ada Lovelace' }), card(), true)
    expect(view.values).toEqual(card())
    expect(view.accountDiffers).toEqual({ bio: 'Account bio.', image: 'https://x/acct.png' })
  })

  it('reports an empty account field as differing, so it can be filled in on request', () => {
    expect(sharedProfileView(account({ bio: null }), card(), true).accountDiffers).toEqual({ bio: null, image: 'https://x/acct.png' })
  })

  it('shows the account alone when there is no card, or the card is not kept in step', () => {
    expect(sharedProfileView(account(), null, false)).toEqual({ values: account(), linked: false, accountDiffers: {} })
    expect(sharedProfileView(account(), card(), false).values).toEqual(account())
  })

  it('whitespace differences are not differences', () => {
    expect(sharedProfileView(account({ bio: ' Card bio. ', image: 'https://x/card.png' }), card(), true).accountDiffers).toEqual({})
  })
})

describe('previewPublicProfile', () => {
  it('shows the unsaved biography on both the author page and the team card (the old preview did not)', () => {
    const view = sharedProfileView(account({ bio: 'Card bio.', image: 'https://x/card.png' }), card(), true)
    const preview = previewPublicProfile({ view, card: facts, pending: { bio: 'Typing a new bio' } })
    expect(preview.author.bio).toBe('Typing a new bio')
    expect(preview.teamCard).toMatchObject({ bio: 'Typing a new bio', onPublicPage: true })
  })

  it('matches visibleAuthorProfile for a public card with no photo: account photo on the author page, initials on Our Team', () => {
    const view = sharedProfileView(account(), card({ image: null }), true)
    const preview = previewPublicProfile({ view, card: facts, pending: {} })
    const real = visibleAuthorProfile({
      name: 'Ada Lovelace', email: 'ada@ed.ac.uk', bio: 'Account bio.', image: 'https://x/acct.png', isActive: true, isBanned: false,
      teamProfile: { name: 'Ada Lovelace', role: 'Writer', bio: 'Card bio.', image: null, isActive: true },
    }, { testingMode: false })
    expect(preview.author).toMatchObject({ bio: real.bio, image: real.image })
    expect(preview.teamCard?.image).toBeNull()
  })

  it('a hidden card leaves the author page on the account details and says it is not public', () => {
    const view = sharedProfileView(account(), card(), true)
    const preview = previewPublicProfile({ view, card: { ...facts, isActive: false }, pending: {} })
    expect(preview.author).toMatchObject({ bio: 'Account bio.', image: 'https://x/acct.png' })
    expect(preview.teamCard?.onPublicPage).toBe(false)
  })

  it('clearing the biography would take the card off the page', () => {
    const view = sharedProfileView(account(), card(), true)
    expect(previewPublicProfile({ view, card: facts, pending: { bio: '' } }).teamCard?.onPublicPage).toBe(false)
  })

  it('an account without a card previews just the form', () => {
    const view = sharedProfileView(account(), null, false)
    expect(previewPublicProfile({ view, card: null, pending: { name: 'New' } })).toEqual({
      author: { ...account(), name: 'New' },
      teamCard: null,
    })
  })
})

describe('profileEditorState', () => {
  const base = { name: 'Ada', bio: 'b', image: null, email: 'ada@ed.ac.uk', isActive: true, isBanned: false }

  it('marks a suspended or test account’s card as unable to appear, whatever the form says', () => {
    const cardRow = { name: 'Ada', bio: 'b', image: null, role: 'Writer', isActive: true }
    expect(profileEditorState({ ...base, role: 'WRITER', isBanned: true }, cardRow, { testingMode: false }).card?.blockedRegardless).toBe(true)
    expect(profileEditorState({ ...base, role: 'WRITER', email: 'test-ada@ed.ac.uk' }, cardRow, { testingMode: false }).card?.blockedRegardless).toBe(true)
    expect(profileEditorState({ ...base, role: 'WRITER' }, cardRow, { testingMode: false }).card).toEqual({ isActive: true, positionLabel: 'Writer', blockedRegardless: false })
  })

  it('a reader with a leftover card edits only the account', () => {
    const state = profileEditorState({ ...base, role: 'READER' }, { name: 'Old', bio: 'old', image: null, role: 'Writer', isActive: true }, { testingMode: false })
    expect(state.view.linked).toBe(false)
    expect(state.card).toBeNull()
  })
})
