import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChallengeHero, statusLine } from '@/components/trading/ChallengeHero'
import { PrizePodium } from '@/components/trading/PrizePodium'
import { MarketChart } from '@/components/trading/MarketChart'
import { ChallengeRules } from '@/components/trading/ChallengeRules'
import { ChallengeFaq } from '@/components/trading/ChallengeFaq'
import { RegistrationPanel } from '@/components/trading/RegistrationPanel'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { TRADING_CHALLENGE, nonStudentMailto } from '@/lib/tradingChallenge'

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
    const text = html.replace(/<[^>]+>/g, '')
    for (const amount of ['£100', '£50', '£25']) expect(text).toContain(amount)
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
  const html = renderToStaticMarkup(<MarketChart phase="upcoming" progress={0} daysToStart={8} />)

  it('is labelled as illustrative and hidden from assistive technology', () => {
    expect(html).toContain('Illustrative chart. Not market data or competition results.')
    const svgs = [...html.matchAll(/<svg[^>]*>/g)].map((m) => m[0])
    expect(svgs).toHaveLength(4)
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"')
    // The graphic's only text is the real calendar and the marker: no prices or percentages.
    const labels = [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
    expect(labels).toEqual(['NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'OPENING BELL'])
  })

  it('ships the complete chart in the HTML; the reveal is CSS only', () => {
    // All 28 candles and the trend line are in the server markup, inside the reveal layer.
    const reveal = html.slice(html.indexOf('trading-reveal '), html.indexOf('trading-glint '))
    expect(reveal.match(/<rect/g)).toHaveLength(28)
    expect(reveal).toContain('fill="url(#trading-area)"')
    // The glint layer redraws the same line, so it lines up with the trend beneath.
    const glint = html.slice(html.indexOf('trading-glint '))
    const line = (chunk: string) => chunk.match(/<path d="(M[^"]+)"[^>]*class="fill-none/)?.[1] ?? chunk.match(/d="(M[^"]+)"/)?.[1]
    expect(line(glint)).toBe(line(reveal.slice(reveal.indexOf('</rect>'))))
    expect(html).not.toMatch(/opacity:\s*0/)
  })
})

describe('rules and settings', () => {
  const html = renderToStaticMarkup(<ChallengeRules />)

  it('shows the competition at a glance with the prizes, and no detailed game settings', () => {
    for (const text of ['Competition at a glance', 'Organiser', 'Platform', 'Competition dates', 'Starting balance', 'Markets', 'Prizes', 'Nasdaq, NYSE, NYSE American and OTC', '£100', '£50', '£25', '28 October 2026', '25 March 2027']) {
      expect(html).toContain(text)
    }
    for (const text of ['Commission', 'Order types', 'Fractional', 'Minimum share price', 'Interest', 'Short selling', 'Margin']) {
      expect(html).not.toContain(text)
    }
  })

  it('keeps the official rules on eligibility, registration and winner verification', () => {
    for (const title of ['Eligibility', 'Registration and the game password', 'Prizes and winner verification', 'Ineligible entries', 'Ties']) {
      expect(html).toContain(title)
    }
    expect(html).toContain('register by emailing the committee')
  })
})

describe('non-student registration', () => {
  const panel = renderToStaticMarkup(
    <RegistrationPanel
      student={{ responderUrl: TRADING_CHALLENGE.registration.student.responderUrl, embedUrl: null }}
      nonStudentMailto={nonStudentMailto()}
      supportEmail={TRADING_CHALLENGE.supportEmail}
      membershipUrl={TRADING_CHALLENGE.links.membership}
      lateEntry={false}
    />,
  )

  it('offers an email to the committee instead of a form, without promising instant access', () => {
    expect(panel).toContain('Not a University of Edinburgh student?')
    expect(panel).toContain('Contact EconSoc to Register')
    expect(panel).toContain(`href="${nonStudentMailto().replace(/&/g, '&amp;')}"`)
    expect(panel).toContain('Never send a password.')
    expect(panel).toContain('your login details follow once that check is done')
    expect(panel).not.toMatch(/opening soon|isn’t open yet/i)
    // Only the student route has a Google Form.
    expect(panel.match(/docs\.google\.com/g)).toHaveLength(1)
  })

  it('leaves no “opening soon” wording in the FAQ', () => {
    const faq = renderToStaticMarkup(<ChallengeFaq />)
    expect(faq).not.toMatch(/opens soon|opening soon/i)
    expect(faq).toContain('MarketWatch display name')
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
