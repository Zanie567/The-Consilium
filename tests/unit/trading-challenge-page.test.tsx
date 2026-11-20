/**
 * The Trading Challenge is coming in Semester 2 (2026–27), with trading dates TBC.
 * Test real render across the withdrawn November–March window to prevent a false
 * 'live' or 'closed' state while registration remains open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TradingChallengePage, { metadata } from '@/app/trading-challenge/page'
import { TRADING_CHALLENGE } from '@/lib/tradingChallenge'

const GAME = 'https://www.marketwatch.com/games/the-econsoc-trading-challenge'

function pageAt(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
  const html = renderToStaticMarkup(<TradingChallengePage />)
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }
}
afterEach(() => vi.useRealTimers())

describe('semester 2 announcement without exact dates', () => {
  for (const day of [
    '2026-11-20T12:00:00Z', '2026-11-23T12:00:00Z',
    '2027-01-15T12:00:00Z', '2027-03-25T12:00:00Z',
  ]) {
    it(`keeps registration open and displays no withdrawn dates on ${day}`, () => {
      const { html, text } = pageAt(day)
      expect(text).toContain('Coming in Semester 2')
      expect(text).toContain('Registration open')
      expect(text.toLowerCase()).toContain('dates to be confirmed')
      expect(text).toContain('Register for the Challenge')
      expect(text.toLowerCase()).toContain('the same registration form remains open')
      expect(text).toContain('The competition has not started')
      expect(text).not.toMatch(/23 November|24 March|In progress|Trading closed|Results are being verified|four months of trading|Trading opens tomorrow|days to the opening bell/)
      expect(html).toContain('href="#register"')
      expect(html).not.toContain(`href="${GAME}"`)
      expect(html).not.toContain(`href="${GAME}/rankings"`)
    })
  }
})

describe('registration, content and social metadata', () => {
  const { html, text } = pageAt('2026-11-20T12:00:00Z')
  it('preserves Google Forms registration and committee email', () => {
    expect(html).toContain(`href="${TRADING_CHALLENGE.registration.student.responderUrl}"`)
    expect(text).toContain('Contact EconSoc to Register')
    expect(html).toContain('economics.society@ed.ac.uk')
    expect(html).not.toMatch(/docs\.google\.com\/spreadsheets|script\.google\.com/)
  })
  it('retains the prizes, sections, and decorative chart', () => {
    expect(text).toContain('$100,000')
    expect(text).toContain('£175')
    expect(text).toContain('The rules')
    expect(text).toContain('Questions')
    expect(text).toContain('How to enter')
    expect(text).toContain('Competition dates')
    expect(text).toContain('Semester 2 (2026–27)')
    expect(html).toContain('trading-plot')
  })
  it('replaces withdrawn social metadata and share image', () => {
    expect(metadata.description).toContain('coming in Semester 2 (2026–27)')
    expect(metadata.description).toContain('Registration remains open')
    const og = metadata.openGraph as { description?: string; images?: { url: string }[] }
    expect(og.description).toBe(metadata.description)
    expect(JSON.stringify(metadata)).not.toContain('/og/trading-challenge-v3.png')
    expect(JSON.stringify(metadata)).toContain('consilium-share')
    expect(JSON.stringify(metadata)).not.toMatch(/23 November 2026|24 March 2027/)
  })
})
