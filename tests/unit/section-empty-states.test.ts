import { describe, expect, it } from 'vitest'
import {
  getAuthorEmptyState,
  getSectionEmptyState,
  getTagEmptyState,
  noResultsEmptyState,
  siteEmptyState,
} from '@/lib/sectionEmptyStates'

describe('getSectionEmptyState', () => {
  it('uses the bespoke copy written for a known section', () => {
    const state = getSectionEmptyState('news', 'News')
    expect(state.title).toBe('News Coming Soon')
    expect(state.description).toBe('Economic news and commentary. More articles are on the way.')
    expect(state.icon).not.toBe('')
  })

  it('falls back to generic copy for a section added after this file was written', () => {
    const state = getSectionEmptyState('markets', 'Markets')
    expect(state.title).toBe('Markets Coming Soon')
    expect(state.description).toBe('No markets articles published yet. Check back soon.')
    expect(state.icon).not.toBe('')
  })

  it('always supplies an icon, title and description', () => {
    for (const slug of ['news', 'opinion', 'analysis', 'interviews', 'unknown-slug']) {
      const state = getSectionEmptyState(slug, 'Anything')
      expect(state.icon.length).toBeGreaterThan(0)
      expect(state.title.length).toBeGreaterThan(0)
      expect(state.description.length).toBeGreaterThan(0)
    }
  })
})

describe('empty state copy', () => {
  it('promises more content only where more content is actually coming', () => {
    expect(siteEmptyState.description).toMatch(/on the way/i)
    expect(getTagEmptyState('Inflation').description).toContain('Inflation')

    // A filtered/searched list must never claim more is coming — the reader
    // narrowed it themselves, and the useful next step is widening it again.
    expect(noResultsEmptyState.description).not.toMatch(/coming soon|on the way/i)
    expect(noResultsEmptyState.description).toMatch(/clear the filters/i)
  })

  it('distinguishes a filtered author page from an empty one', () => {
    expect(getAuthorEmptyState(true).title).toBe('Nothing in This Section')
    expect(getAuthorEmptyState(false).title).toBe('More Coming Soon')
  })
})
