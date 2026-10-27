import { describe, expect, it } from 'vitest'
import { classifyTrafficSource, referrerLabel } from '@/lib/analyticsTrafficSource'

describe('traffic-source attribution from recorded referrers', () => {
  it('recognises historical referrals when the source column is empty', () => {
    expect(classifyTrafficSource(null, 'https://www.google.com/')).toBe('Search')
    expect(classifyTrafficSource(null, 'https://www.ecosia.org/search')).toBe('Search')
    expect(classifyTrafficSource(null, 'https://l.instagram.com')).toBe('Social')
    expect(classifyTrafficSource(null, 'https://www.linkedin.com')).toBe('Social')
  })
  it('does not confuse our own domain with an external referral', () => {
    expect(classifyTrafficSource(null, 'https://www.theconsilium.co.uk/')).toBe('Internal')
    expect(classifyTrafficSource(null, 'https://the-consilium.vercel.app/login')).toBe('Internal')
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

it('labels referral origins without exposing URL paths', () => {
  expect(referrerLabel('https://l.instagram.com/some/private/path?code=secret')).toBe('Instagram')
  expect(referrerLabel('https://www.google.com/search?q=test')).toBe('Google')
  expect(referrerLabel('https://www.linkedin.com/')).toBe('LinkedIn')
  expect(referrerLabel('https://www.theconsilium.co.uk/articles/a')).toBeNull()
  expect(referrerLabel(null)).toBeNull()
})

it('does not confuse Google account login or Gmail with organic search', () => {
  expect(classifyTrafficSource(null, 'https://accounts.google.com/')).toBe('Other')
  expect(classifyTrafficSource(null, 'https://mail.google.com/')).toBe('Email')
  expect(referrerLabel('https://accounts.google.com/')).toBe('Google sign-in')
  expect(referrerLabel('https://mail.google.com/')).toBe('Gmail')
})

it('uses tagged arrival source and distinguishes later internal navigation even without referrer', () => {
  expect(classifyTrafficSource(null, null, 'entry', 'instagram', 'social')).toBe('Social')
  expect(classifyTrafficSource(null, null, 'entry', 'newsletter', 'email')).toBe('Email')
  expect(classifyTrafficSource(null, null, 'entry', 'google', 'search')).toBe('Search')
  expect(classifyTrafficSource(null, null, 'entry', 'edinburgh_econsoc', 'referral')).toBe('Other')
  expect(classifyTrafficSource(null, null, 'internal')).toBe('Internal')
  expect(classifyTrafficSource(null, null, null)).toBe('Direct / unknown')
})
