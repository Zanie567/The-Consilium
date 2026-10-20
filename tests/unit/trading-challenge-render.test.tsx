import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChallengeHero, statusLine } from '@/components/trading/ChallengeHero'
import { PrizePodium } from '@/components/trading/PrizePodium'
import { MarketChart } from '@/components/trading/MarketChart'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { TRADING_CHALLENGE } from '@/lib/tradingChallenge'

const hero = (phase: 'upcoming' | 'live' | 'closed', resultsPublished = false) =>
  renderToStaticMarkup(<ChallengeHero phase={phase} progress={phase === 'upcoming' ? 0 : phase === 'live' ? 0.5 : 1} daysToStart={8} resultsPublished={resultsPublished} />)

describe('competition status wording', () => {
  it('before the start: registration open, trading opens on the start date', () => {
    expect(statusLine('upcoming', false)).toEqual({ tone: 'open', label: 'Registration open', detail: 'Trading opens Wednesday 28 October' })
    const html = hero('upcoming')
    expect(html).toContain('Enter the Challenge')
    expect(html).toContain('href="#register"')
    expect(html).toContain('8 days to the opening bell')
  })

  it('during the competition: in progress, late entries welcome', () => {
    expect(statusLine('live', false)).toMatchObject({ label: 'In progress', detail: 'Late entries welcome until 25 March' })
    const html = hero('live')
    expect(html).toContain('Enter the Challenge')
    expect(html).toContain(TRADING_CHALLENGE.links.game)
    expect(html).not.toContain('opening bell</span>')
  })

  it('after the end: no entry call to action, results pending verification', () => {
    expect(statusLine('closed', false)).toMatchObject({ label: 'Trading closed', detail: 'Results are being verified' })
    const html = hero('closed')
    expect(html).not.toContain('Enter the Challenge')
    expect(html).not.toContain('href="#register"')
    expect(html).toContain('Standings and results')
    expect(statusLine('closed', true).label).toBe('Results announced')
    expect(hero('closed', true)).toContain('See the winners')
  })
})

describe('prize podium', () => {
  it('lists places in rank order for assistive technology, with the confirmed amounts', () => {
    const html = renderToStaticMarkup(<PrizePodium prizes={TRADING_CHALLENGE.prizes} />)
    const order = [...html.matchAll(/data-place="(\d)"/g)].map((m) => m[1])
    expect(order).toEqual(['1', '2', '3'])
    for (const amount of ['£100', '£50', '£25']) expect(html).toContain(amount)
  })

  it('shows verified winners only when they are passed in', () => {
    const html = renderToStaticMarkup(
      <PrizePodium prizes={TRADING_CHALLENGE.prizes} winners={[{ place: 1, displayName: 'Verified Winner', finalReturnPct: 12.34 }]} />,
    )
    expect(html).toContain('Verified winners')
    expect(html).toContain('Verified Winner')
    expect(html).toContain('+12.3%')
  })
})

describe('illustrative chart', () => {
  it('is labelled as illustrative and hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<MarketChart phase="upcoming" progress={0} daysToStart={8} />)
    expect(html).toContain('Illustrative chart. Not market data or competition results.')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    // The graphic's only text is the real calendar and the marker: no prices or percentages.
    const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'))
    const labels = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
    expect(labels).toEqual(['NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'OPENING BELL'])
  })
})

describe('entrance reveals (LCP guard)', () => {
  it('never ship server HTML that is invisible until JavaScript runs', () => {
    const html = renderToStaticMarkup(
      <AnimateIn delay={0.1}>
        <h1>Headline</h1>
        <StaggerContainer>
          <StaggerItem>One</StaggerItem>
        </StaggerContainer>
      </AnimateIn>,
    )
    expect(html).not.toMatch(/opacity:\s*0/)
    expect(html).toContain('class="consilium-reveal"')
    expect(html).toContain('--reveal-delay:0.1s')
    expect(html).toContain('data-reveal-group=""')
  })
})
