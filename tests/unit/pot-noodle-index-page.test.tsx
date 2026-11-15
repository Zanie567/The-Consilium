/**
 * The /pot-noodle-index page rendered on the server, before and after a form URL and results are
 * configured. The page must never show a number until results pass publishableResults, and never
 * link to a form that was not supplied.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/link', () => ({ default: ({ children, href, prefetch: _p, ...props }: { children: React.ReactNode; href: string; prefetch?: boolean }) => <a href={href} {...props}>{children}</a> }))

async function render(config: Record<string, unknown> = {}) {
  vi.resetModules()
  const actual = await vi.importActual<typeof import('@/lib/potNoodleIndex')>('@/lib/potNoodleIndex')
  vi.doMock('@/lib/potNoodleIndex', () => ({ ...actual, POT_NOODLE_INDEX: { ...actual.POT_NOODLE_INDEX, ...config } }))
  const { default: Page, metadata } = await import('@/app/pot-noodle-index/page')
  const html = renderToStaticMarkup(<Page />)
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), metadata }
}

afterEach(() => { vi.doUnmock('@/lib/potNoodleIndex') })

describe('pot noodle index page', () => {
  it('before a form is configured: collecting, the requested wording, no numbers, no form link', async () => {
    const { html, text, metadata } = await render({ form: { responderUrl: null } })
    expect(text).toContain('Collecting prices now')
    expect(text).toContain('The Pot Noodle Index is collecting data now and will be updated once we have enough responses. Please fill in the form and share it with others.')
    expect(text).toContain('from the weekly shop to a pint at the student bar')
    expect(text).toContain('The form opens here soon')
    expect(html).not.toContain('docs.google.com')
    expect(html).not.toContain('forms.gle')
    expect(html).not.toContain('<iframe')
    // No figure anywhere: the label shows empty slots and the receipt says "Awaiting data".
    expect(text).not.toMatch(/£\s?\d|\d+\.\d+ index/)
    expect(text).toContain('Awaiting data')
    expect(metadata.alternates?.canonical).toBe('/pot-noodle-index')
    expect(metadata.title).toBe('The Pot Noodle Index')
  })

  it('with a form URL: offers the direct link and the consent-aware embed, and still no iframe on first load', async () => {
    const responderUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSexample/viewform'
    const { html, text } = await render({ form: { responderUrl } })
    expect(html).toContain(`href="${responderUrl}"`)
    expect(text).toContain('Open in Google Forms')
    expect(text).toContain('Load the form here')
    expect(html).not.toContain('<iframe')
    expect(text).not.toContain('The form opens here soon')
  })

  it('as shipped: the editors’ form, behind the consent-aware embed', async () => {
    const { html, text } = await render()
    expect(html).toContain('href="https://docs.google.com/forms/d/e/1FAIpQLSeS11HO0EzhS-MkarU7FJHeRxfiC6_2gLDahBYkUBM9wHmSAA/viewform"')
    expect(text).toContain('Load the form here')
    expect(text).toContain('The form asks for your name and email address')
    expect(html).not.toContain('<iframe')
  })

  it('ignores a configured link that is not a Google Form', async () => {
    const { html, text } = await render({ form: { responderUrl: 'https://example.org/survey' } })
    expect(html).not.toContain('example.org')
    expect(text).toContain('The form opens here soon')
  })

  it('shows verified results only when they pass validation', async () => {
    const results = {
      published: true, unit: 'index points', decimals: 1, updatedAt: '2027-02-01', collectedFrom: '2026-11-20', collectedTo: '2027-01-31',
      responses: 240, minimumPlaceResponses: 20, series: [{ date: '2026-12-31', value: 100 }, { date: '2027-01-31', value: 105 }],
      places: [{ name: 'Edinburgh', value: 104.2, responses: 80 }], methodology: ['Prices are converted to pounds at the month’s average rate.'],
    }
    const shown = await render({ results })
    expect(shown.text).toContain('Results published')
    expect(shown.text).toContain('105.0')
    expect(shown.text).toContain('index points')
    expect(shown.text).toContain('Up 5% since the previous update')
    expect(shown.text).toContain('Edinburgh')
    expect(shown.text).toContain('Prices are converted to pounds at the month’s average rate.')
    const withheld = await render({ results: { ...results, methodology: [] } })
    expect(withheld.text).not.toContain('105.0')
    expect(withheld.text).toContain('Collecting prices now')
  })
})
