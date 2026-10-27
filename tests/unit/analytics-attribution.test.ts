import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())

describe('one-document lifetime acquisition and campaign parsing', () => {
  it('records the external entry once, then suppresses repeat acquisition', async () => {
    const { landingAttribution } = await import('@/lib/analyticsAttribution')
    expect(landingAttribution('https://l.instagram.com/story', '?utm_source=instagram&utm_medium=social&utm_campaign=edition_01&utm_content=story_01')).toEqual({
      entryKind: 'entry',
      referrer: 'https://l.instagram.com/story',
      campaignSource: 'instagram',
      campaignMedium: 'social',
      campaignName: 'edition_01',
      campaignContent: 'story_01',
    })
    expect(landingAttribution('https://l.instagram.com/story', '?utm_source=instagram&utm_medium=social&utm_campaign=edition_01')).toEqual({
      entryKind: 'internal',
      referrer: null,
    })
  })
  it('does not attribute incomplete or risky labels to a campaign', async () => {
    const { landingAttribution } = await import('@/lib/analyticsAttribution')
    const first = landingAttribution('', '?utm_source=person%40example.com&utm_medium=social&utm_campaign=hello')
    expect(first).toEqual({ entryKind: 'entry', referrer: null })
  })
  it('does not attribute subsequent navigation out of the editorial portal as acquisition', async () => {
    const { noteUntrackedInitialRoute, landingAttribution } = await import('@/lib/analyticsAttribution')
    noteUntrackedInitialRoute()
    expect(landingAttribution('https://google.com', '?utm_source=google&utm_medium=search&utm_campaign=launch')).toEqual({
      entryKind: 'internal', referrer: null,
    })
  })
  it('does not accept free-text personal data or long campaign labels', async () => {
    const { landingAttribution } = await import('@/lib/analyticsAttribution')
    expect(landingAttribution('', '?utm_source=instagram&utm_medium=social&utm_campaign='+'x'.repeat(100))).toEqual({
      entryKind: 'entry', referrer: null,
    })
  })
})
