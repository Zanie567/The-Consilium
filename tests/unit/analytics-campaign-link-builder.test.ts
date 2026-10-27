import { describe, expect, it } from 'vitest'
import { createCampaignUrl } from '@/app/editorial/(portal)/analytics/CampaignLinkBuilder'

describe('campaign URL generator', () => {
  it('builds canonical, deterministic, taggable promotion links', () => {
    expect(createCampaignUrl(
      '/articles/sanctions-sundaresan',
      'instagram', 'social', 'weekly_edition_02', 'story_01'
    )).toBe('https://theconsilium.co.uk/articles/sanctions-sundaresan?utm_source=instagram&utm_medium=social&utm_campaign=weekly_edition_02&utm_content=story_01')
  })

  it('supports the homepage and omits absent creative tags', () => {
    expect(createCampaignUrl('/', 'newsletter', 'email', 'friday_edition', '')).toBe(
      'https://theconsilium.co.uk/?utm_source=newsletter&utm_medium=email&utm_campaign=friday_edition'
    )
  })

  it('rejects external destinations, unvalidated labels and query parameters', () => {
    expect(createCampaignUrl('//evil.example/', 'instagram', 'social', 'launch', '')).toBeNull()
    expect(createCampaignUrl('/articles/story?token=private', 'instagram', 'social', 'launch', '')).toBeNull()
    expect(createCampaignUrl('/', 'person@example.com', 'social', 'launch', '')).toBeNull()
    expect(createCampaignUrl('/', 'instagram', 'social', '', '')).toBeNull()
    expect(createCampaignUrl('/', 'instagram', 'social', 'a'.repeat(70), '')).toBeNull()
  })
})
