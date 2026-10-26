import { describe, expect, it } from 'vitest'
import { findShortRevalidations, MIN_REVALIDATE_SECONDS } from '../../scripts/verify-build-budget.mjs'
import { PUBLICATION_LINKEDIN_REVALIDATE_SECONDS } from '@/lib/growthSettings'

describe('verify-build-budget', () => {
  it('flags a prerendered route that rebuilds every minute', () => {
    const manifest = { routes: { '/privacy': { initialRevalidateSeconds: 60 }, '/about': { initialRevalidateSeconds: 3600 } } }
    expect(findShortRevalidations(manifest)).toEqual([{ route: '/privacy', seconds: 60 }])
  })

  it('ignores routes that never revalidate on a timer, and allow-listed routes', () => {
    const manifest = { routes: { '/a': { initialRevalidateSeconds: false }, '/b': { initialRevalidateSeconds: 0 }, '/c': { initialRevalidateSeconds: 30 } } }
    expect(findShortRevalidations(manifest, { allowed: { '/c': 'needs it' } })).toEqual([])
  })

  it('the footer link, shown on every page, does not pull pages below the floor', () => {
    expect(PUBLICATION_LINKEDIN_REVALIDATE_SECONDS).toBeGreaterThanOrEqual(MIN_REVALIDATE_SECONDS)
  })
})
