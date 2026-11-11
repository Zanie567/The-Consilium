/**
 * The whole /trading-challenge page rendered at fixed instants, so the automatic phase
 * changes (registration open → in progress → closed) are checked without waiting for the
 * dates. The page computes its phase from the Europe/London calendar date on each render.
 * London is on GMT for every instant below (BST ends 25 Oct 2026, starts 28 Mar 2027), so
 * UTC and London agree.
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

afterEach(() => {
  vi.useRealTimers()
})

describe('trading challenge page over time', () => {
  it('before 23 November: registration open, trading begins Monday 23 November, with a countdown', () => {
    const { html, text } = pageAt('2026-11-11T12:00:00Z')
    expect(text).toContain('Registration open')
    expect(text).toContain('Trading opens Monday 23 November')
    expect(text).toContain('12 days to the opening bell')
    expect(text).toContain('Register for the Challenge')
    expect(text).toContain('Take your seat at the opening bell.')
    expect(text).toContain('four months of trading')
    expect(text).toContain('Trading opens 23 November.')
    expect(text).not.toContain('In progress')
    expect(html).toContain('href="#register"')
    expect(text).toContain('Already verified?')
  })

  it('on the eve, late in the evening, it is still upcoming: "Trading opens tomorrow"', () => {
    const { text } = pageAt('2026-11-22T23:59:00Z')
    expect(text).toContain('Registration open')
    expect(text).toContain('Trading opens tomorrow')
  })

  it('from the first minute of 23 November: in progress, late entry open, no countdown', () => {
    const { html, text } = pageAt('2026-11-23T00:00:00Z')
    expect(text).toContain('In progress')
    expect(text).toContain('Late entries welcome until 24 March')
    expect(text).not.toContain('Registration open')
    expect(text).not.toContain('opening bell</span>')
    expect(text).not.toMatch(/days to the opening bell|Trading opens/)
    expect(text).toContain('There’s still time to take your seat at the table.')
    expect(text).toContain('Late entries are open until 24 March 2027.')
    expect(html).toContain('href="#register"')
    expect(html).toContain(`href="${GAME}"`)
  })

  it('stays in progress through the last day, 24 March 2027', () => {
    const { text } = pageAt('2027-03-24T23:59:00Z')
    expect(text).toContain('In progress')
  })

  it('from 25 March 2027: registration closed, results pending verification, no entry links', () => {
    const { html, text } = pageAt('2027-03-25T00:00:00Z')
    expect(text).toContain('Trading closed')
    expect(text).toContain('Results are being verified')
    expect(text).toContain('Registration has closed')
    expect(text).toContain('Final rankings on MarketWatch')
    expect(html).not.toContain('href="#register"')
    expect(text).not.toContain('Enter the Challenge')
    expect(text).not.toContain('Already verified?')
  })
})

describe('trading challenge page links and content', () => {
  const { html, text } = pageAt('2026-11-11T12:00:00Z')

  it('links only the current MarketWatch game for the game and its rankings', () => {
    const gameLinks = [...html.matchAll(/href="(https:\/\/www\.marketwatch\.com\/games\/[^"]*)"/g)].map((m) => m[1])
    expect(gameLinks).toEqual(expect.arrayContaining([GAME, `${GAME}/rankings`]))
    for (const href of gameLinks) expect([GAME, `${GAME}/rankings`]).toContain(href)
    expect(html).not.toMatch(/the-econsoc-trading-challenge-(2026-27|26-27)/)
    // The generic MarketWatch sign-up link (step 1) is not a game link and is kept.
    expect(html).toContain('href="https://www.marketwatch.com/games"')
  })

  it('keeps both registration routes: the student Google Form and the non-student email', () => {
    expect(html).toContain(`href="${TRADING_CHALLENGE.registration.student.responderUrl}"`)
    expect(text).toContain('Contact EconSoc to Register')
    expect(html).not.toMatch(/docs\.google\.com\/spreadsheets|script\.google\.com/)
  })

  it('states the new dates everywhere and none of the old ones', () => {
    expect(text).toContain('23 November – 24 March 2027')
    expect(text).toContain('trade from 23 November')
    expect(text).not.toMatch(/\b9 Nov(ember)?\b|four and a half months|\bTies\b|To be confirmed/)
  })

  it('builds the search and share text from the new dates, with the new share card', () => {
    expect(metadata.description).toContain('Trading runs 23 November 2026 to 24 March 2027 on MarketWatch.')
    const og = metadata.openGraph as { description?: string; images?: { url: string }[] }
    expect(og.description).toBe(metadata.description)
    expect(JSON.stringify(metadata)).toContain('/og/trading-challenge-v3.png')
    expect(JSON.stringify(metadata)).not.toContain('trading-challenge-v2.png')
  })
})
