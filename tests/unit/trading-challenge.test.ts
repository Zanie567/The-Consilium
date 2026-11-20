import { describe, expect, it } from 'vitest'
import {
  TRADING_CHALLENGE,
  TOTAL_PRIZE_POOL_GBP,
  challengePhase,
  daysUntil,
  formatChallengeDate,
  googleFormEmbedUrl,
  londonDate,
  nonStudentMailto,
  publishedWinners,
  windowProgress,
} from '@/lib/tradingChallenge'

describe('competition facts', () => {
  it('preserves the competition facts while postponing trading to Semester 2', () => {
    expect(TRADING_CHALLENGE.schedule).toEqual({ postponed: true, semester: 'Semester 2 (2026–27)' })
    // These dates are withdrawn, and must not appear on the public page.
    expect(TRADING_CHALLENGE.startDate).toBe('2026-11-23')
    expect(TRADING_CHALLENGE.endDate).toBe('2027-03-24')
    expect(TRADING_CHALLENGE.startingCapitalUsd).toBe(100_000)
    expect(TRADING_CHALLENGE.prizes.map((p) => [p.place, p.amountGbp])).toEqual([[1, 100], [2, 50], [3, 25]])
    expect(TOTAL_PRIZE_POOL_GBP).toBe(175)
  })

  it('retains the withdrawn dates only for scheduled-mode helper compatibility', () => {
    expect(formatChallengeDate(TRADING_CHALLENGE.startDate, { withYear: false, weekday: true })).toBe('Monday 23 November')
    const days = daysUntil(new Date(`${TRADING_CHALLENGE.startDate}T12:00:00Z`), TRADING_CHALLENGE.endDate)
    expect(days).toBeGreaterThanOrEqual(120) // four months
    expect(days).toBeLessThan(135) // short of four and a half
  })

  it('links the current MarketWatch game, never an earlier one', () => {
    expect(TRADING_CHALLENGE.links.game).toBe('https://www.marketwatch.com/games/the-econsoc-trading-challenge')
    expect(TRADING_CHALLENGE.links.rankings).toBe(`${TRADING_CHALLENGE.links.game}/rankings`)
    // The current slug is a prefix of both earlier ones, so match the earlier slugs exactly.
    expect(JSON.stringify(TRADING_CHALLENGE)).not.toMatch(/the-econsoc-trading-challenge-(2026-27|26-27)/)
  })

  it('has no pending, unannounced decisions (the tie-break placeholder was withdrawn)', () => {
    expect(TRADING_CHALLENGE).not.toHaveProperty('pendingDecisions')
  })

  it('registers non-student members by email to the committee, with no form and no automation', () => {
    expect(Object.keys(TRADING_CHALLENGE.registration)).toEqual(['student', 'nonStudent'])
    expect(TRADING_CHALLENGE.registration.nonStudent).not.toHaveProperty('responderUrl')
    const link = nonStudentMailto()
    expect(link.startsWith('mailto:economics.society@ed.ac.uk?subject=')).toBe(true)
    const params = new URLSearchParams(link.slice(link.indexOf('?') + 1).replace(/\+/g, '%2B'))
    expect(params.get('subject')).toBe('Trading Challenge – Non-Student Registration')
    const body = params.get('body') ?? ''
    for (const field of ['Full name:', 'MarketWatch display name:', 'Email address used to buy my EconSoc membership:']) {
      expect(body).toContain(field)
    }
    // Asks for nothing sensitive, and the encoding keeps spaces as %20 (not "+").
    expect(body).not.toMatch(/password|student number|date of birth|phone/i)
    expect(link).not.toContain('+')
    expect(body.split('\r\n').length).toBeGreaterThan(5)
  })

  it('publishes only the essential settings, never detailed MarketWatch configuration', () => {
    expect(TRADING_CHALLENGE).not.toHaveProperty('settings')
    expect(TRADING_CHALLENGE.markets).toBe('Nasdaq, NYSE, NYSE American and OTC')
  })

  it('publishes no winners until results are explicitly published', () => {
    expect(TRADING_CHALLENGE.results.published).toBe(false)
    expect(publishedWinners()).toEqual([])
    const winners = [
      { place: 2 as const, displayName: 'B' },
      { place: 1 as const, displayName: 'A' },
    ]
    expect(publishedWinners({ published: false, winners })).toEqual([])
    expect(publishedWinners({ published: true, winners }).map((w) => w.displayName)).toEqual(['A', 'B'])
  })
})

describe('competition phase (Europe/London calendar days)', () => {
  it('remains postponed before, during and after the withdrawn trading dates', () => {
    for (const day of [
      '2026-11-20T12:00:00Z', '2026-11-23T00:00:00Z',
      '2027-01-15T09:00:00Z', '2027-03-24T23:59:00Z', '2027-04-02T12:00:00Z',
    ]) expect(challengePhase(new Date(day))).toBe('postponed')
  })

  it('preserves date-based phases for future confirmed schedules', () => {
    expect(challengePhase(new Date('2026-11-22T23:59:00Z'), undefined, undefined, true)).toBe('upcoming')
    expect(challengePhase(new Date('2026-11-23T00:00:00Z'), undefined, undefined, true)).toBe('live')
    expect(challengePhase(new Date('2027-03-24T23:59:00Z'), undefined, undefined, true)).toBe('live')
    expect(challengePhase(new Date('2027-03-25T00:00:00Z'), undefined, undefined, true)).toBe('closed')
    expect(challengePhase(new Date('2026-06-10T23:30:00Z'), '2026-06-11', '2026-06-30', true)).toBe('live')
  })

  it('uses the London calendar across the GMT/BST boundary', () => {
    expect(londonDate(new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-27')
    expect(londonDate(new Date('2026-06-10T23:30:00Z'))).toBe('2026-06-11')
  })
})

describe('date helpers', () => {
  it('counts whole London days to a date', () => {
    expect(daysUntil(new Date('2026-11-11T08:00:00Z'), '2026-11-23')).toBe(12)
    expect(daysUntil(new Date('2026-11-22T23:30:00Z'), '2026-11-23')).toBe(1)
    expect(daysUntil(new Date('2026-11-23T08:00:00Z'), '2026-11-23')).toBe(0)
  })

  it('reports progress through the trading window, clamped to 0–1', () => {
    expect(windowProgress(new Date('2026-10-01T12:00:00Z'))).toBe(0)
    expect(windowProgress(new Date('2027-05-01T12:00:00Z'))).toBe(1)
    const mid = windowProgress(new Date('2027-01-23T12:00:00Z'))
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })

  it('formats dates without depending on the server time zone', () => {
    expect(formatChallengeDate('2026-11-23')).toBe('23 November 2026')
    expect(formatChallengeDate('2026-11-23', { withYear: false, weekday: true })).toBe('Monday 23 November')
    expect(formatChallengeDate('2027-03-24', { withYear: false })).toBe('24 March')
  })
})

describe('Google Form embedding', () => {
  it('derives the embed URL from a docs.google.com responder link', () => {
    expect(googleFormEmbedUrl(TRADING_CHALLENGE.registration.student.responderUrl)).toBe(
      'https://docs.google.com/forms/d/e/1FAIpQLSeC6thVEEGseljEprbWRaGXqBUuDhfunC_5YzW7DqLy0ZT7zA/viewform?embedded=true',
    )
    expect(googleFormEmbedUrl('https://docs.google.com/forms/d/e/abc_DEF-1/viewform?usp=sf_link')).toBe(
      'https://docs.google.com/forms/d/e/abc_DEF-1/viewform?embedded=true',
    )
  })

  it('refuses anything that is not a Google Forms responder link', () => {
    for (const bad of [
      null,
      '',
      'not a url',
      'http://docs.google.com/forms/d/e/abc/viewform',
      'https://evil.example/forms/d/e/abc/viewform',
      'https://docs.google.com.evil.example/forms/d/e/abc/viewform',
      'https://docs.google.com/spreadsheets/d/abc/edit',
      'https://forms.gle/74stmeQto4MBFYJx8',
    ]) {
      expect(googleFormEmbedUrl(bad), String(bad)).toBeNull()
    }
  })
})

describe('no private competition data in the public config', () => {
  it('contains no password, spreadsheet, Apps Script or token values', () => {
    const text = JSON.stringify(TRADING_CHALLENGE).toLowerCase()
    for (const forbidden of ['password', 'docs.google.com/spreadsheets', 'script.google.com', 'apikey', 'token', 'secret']) {
      expect(text, forbidden).not.toContain(forbidden)
    }
  })
})
