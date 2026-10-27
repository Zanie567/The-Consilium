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
  it('match the confirmed competition details', () => {
    expect(TRADING_CHALLENGE.startDate).toBe('2026-11-10')
    expect(TRADING_CHALLENGE.endDate).toBe('2027-03-25')
    expect(TRADING_CHALLENGE.startingCapitalUsd).toBe(100_000)
    expect(TRADING_CHALLENGE.prizes.map((p) => [p.place, p.amountGbp])).toEqual([[1, 100], [2, 50], [3, 25]])
    expect(TOTAL_PRIZE_POOL_GBP).toBe(175)
  })

  it('links the replacement MarketWatch game, never the withdrawn one', () => {
    expect(TRADING_CHALLENGE.links.game).toBe('https://www.marketwatch.com/games/the-econsoc-trading-challenge-26-27')
    expect(TRADING_CHALLENGE.links.rankings).toBe(`${TRADING_CHALLENGE.links.game}/rankings`)
    expect(JSON.stringify(TRADING_CHALLENGE)).not.toContain('the-econsoc-trading-challenge-2026-27')
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
  it('is upcoming before the start date, including late on the eve in London', () => {
    expect(challengePhase(new Date('2026-10-28T12:00:00Z'))).toBe('upcoming')
    // 23:59 UTC on 9 Nov is 23:59 GMT in London (clocks went back on 25 Oct 2026): still the 9th.
    expect(challengePhase(new Date('2026-11-09T23:59:00Z'))).toBe('upcoming')
  })

  it('is live from the first London minute of the start date through the end date', () => {
    expect(challengePhase(new Date('2026-11-10T00:00:00Z'))).toBe('live')
    expect(challengePhase(new Date('2027-01-15T09:00:00Z'))).toBe('live')
    expect(challengePhase(new Date('2027-03-25T23:59:00Z'))).toBe('live')
  })

  it('is closed from the day after the end date', () => {
    expect(challengePhase(new Date('2027-03-26T00:00:00Z'))).toBe('closed')
    expect(challengePhase(new Date('2027-06-01T00:00:00Z'))).toBe('closed')
  })

  it('uses London, not UTC or the server zone, across a BST boundary', () => {
    // 23:30 UTC on 27 Oct 2026 is still 27 Oct in London (GMT after 25 Oct).
    expect(londonDate(new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-27')
    // During BST, 23:30 UTC is already the next day in London.
    expect(londonDate(new Date('2026-06-10T23:30:00Z'))).toBe('2026-06-11')
    expect(challengePhase(new Date('2026-06-10T23:30:00Z'), '2026-06-11', '2026-06-30')).toBe('live')
  })
})

describe('date helpers', () => {
  it('counts whole London days to a date', () => {
    expect(daysUntil(new Date('2026-10-27T08:00:00Z'), '2026-11-10')).toBe(14)
    expect(daysUntil(new Date('2026-11-10T08:00:00Z'), '2026-11-10')).toBe(0)
  })

  it('reports progress through the trading window, clamped to 0–1', () => {
    expect(windowProgress(new Date('2026-10-01T12:00:00Z'))).toBe(0)
    expect(windowProgress(new Date('2027-05-01T12:00:00Z'))).toBe(1)
    const mid = windowProgress(new Date('2027-01-10T12:00:00Z'))
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })

  it('formats dates without depending on the server time zone', () => {
    expect(formatChallengeDate('2026-11-10')).toBe('10 November 2026')
    expect(formatChallengeDate('2026-11-10', { withYear: false, weekday: true })).toBe('Tuesday 10 November')
    expect(formatChallengeDate('2027-03-25', { withYear: false })).toBe('25 March')
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
