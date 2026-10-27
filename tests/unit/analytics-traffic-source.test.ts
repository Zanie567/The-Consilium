import { describe, expect, it } from 'vitest'
import { classifyTrafficSource } from '@/lib/analyticsTrafficSource'

describe('traffic-source attribution from recorded referrers', () => {
  it('recognises historical referrals when the source column is empty', () => {
    expect(classifyTrafficSource(null, 'https://www.google.com/')).toBe('Search')
    expect(classifyTrafficSource(null, 'https://www.ecosia.org/search')).toBe('Search')
    expect(classifyTrafficSource(null, 'https://l.instagram.com')).toBe('Social')
    expect(classifyTrafficSource(null, 'https://www.linkedin.com')).toBe('Social')
  })
  it('does not confuse our own domain with an external referral', () => {
    expect(classifyTrafficSource(null, 'https://www.theconsilium.co.uk/')).toBe('Direct / unknown')
    expect(classifyTrafficSource(null, 'https://the-consilium.vercel.app/login')).toBe('Direct / unknown')
  })
  it('does not claim that a missing referrer proves direct traffic', () => {
    expect(classifyTrafficSource(null, null)).toBe('Direct / unknown')
    expect(classifyTrafficSource(null, '')).toBe('Direct / unknown')
    expect(classifyTrafficSource('Email', null)).toBe('Email')
    expect(classifyTrafficSource(null, 'https://example.org/story')).toBe('Other')
    expect(classifyTrafficSource(null, 'this-is-not-a-url')).toBe('Direct / unknown')
  })
  it('uses strict hostname boundaries, not substring lookalikes', () => {
    expect(classifyTrafficSource(null, 'https://google.com.evil.example/')).toBe('Other')
    expect(classifyTrafficSource(null, 'https://instagram.com.evil.example/')).toBe('Other')
  })
})
