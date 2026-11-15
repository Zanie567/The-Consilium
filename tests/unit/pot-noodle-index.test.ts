import { describe, expect, it } from 'vitest'
import { POT_NOODLE_INDEX, formatValue, latestChange, publishableResults, type PublishedResults } from '@/lib/potNoodleIndex'
import { googleFormEmbedUrl, isGoogleFormLink } from '@/lib/googleForms'

const VALID: PublishedResults = {
  published: true,
  unit: 'index points',
  decimals: 1,
  updatedAt: '2027-02-01',
  collectedFrom: '2026-11-20',
  collectedTo: '2027-01-31',
  responses: 240,
  minimumPlaceResponses: 20,
  series: [{ date: '2026-12-31', value: 100 }, { date: '2027-01-31', value: 105 }],
  places: [{ name: 'Edinburgh', value: 104.2, responses: 80 }],
  methodology: ['Prices are converted to pounds at the month’s average rate.'],
}

describe('the Pot Noodle Index config', () => {
  it('uses the editors’ form, as an embeddable responder link, and publishes no results yet', () => {
    expect(POT_NOODLE_INDEX.form.responderUrl).toBe('https://docs.google.com/forms/d/e/1FAIpQLSeS11HO0EzhS-MkarU7FJHeRxfiC6_2gLDahBYkUBM9wHmSAA/viewform')
    expect(googleFormEmbedUrl(POT_NOODLE_INDEX.form.responderUrl)).toMatch(/\?embedded=true$/)
    expect(POT_NOODLE_INDEX.results.published).toBe(false)
    expect(publishableResults()).toBeNull()
  })
})

describe('publishableResults', () => {
  it('accepts a complete, consistent set', () => {
    expect(publishableResults(VALID)).toBe(VALID)
  })

  it.each<[string, Partial<PublishedResults>]>([
    ['no methodology', { methodology: ['  '] }],
    ['an empty series', { series: [] }],
    ['a zero or negative value', { series: [{ date: '2027-01-31', value: 0 }] }],
    ['dates out of order', { series: [{ date: '2027-01-31', value: 100 }, { date: '2026-12-31', value: 105 }] }],
    ['no unit', { unit: ' ' }],
    ['an impossible precision', { decimals: 7 }],
    ['an invalid date', { updatedAt: '31/01/2027' }],
    ['collection ending before it starts', { collectedFrom: '2027-02-01', collectedTo: '2027-01-01' }],
    ['no responses', { responses: 0 }],
    ['a place below its own minimum', { places: [{ name: 'Glasgow', value: 99, responses: 5 }] }],
    ['an unnamed place', { places: [{ name: ' ', value: 99, responses: 50 }] }],
  ])('withholds everything when there is %s', (_label, change) => {
    expect(publishableResults({ ...VALID, ...change })).toBeNull()
  })

  it('formats values at their published precision and compares them', () => {
    expect(formatValue(104.25, VALID)).toBe('104.3')
    expect(formatValue(1234, { decimals: 0 })).toBe('1,234')
    expect(latestChange(VALID.series)).toBe(5)
    expect(latestChange(VALID.series.slice(0, 1))).toBeNull()
  })
})

describe('Google Forms links', () => {
  const RESPONDER = 'https://docs.google.com/forms/d/e/1FAIpQLSexample_ID-123/viewform'

  it('embeds only a docs.google.com responder link', () => {
    expect(googleFormEmbedUrl(RESPONDER)).toBe('https://docs.google.com/forms/d/e/1FAIpQLSexample_ID-123/viewform?embedded=true')
    for (const bad of [null, 'https://forms.gle/abc', 'http://docs.google.com/forms/d/e/x/viewform', 'https://evil.test/forms/d/e/x/viewform', 'not a url']) {
      expect(googleFormEmbedUrl(bad)).toBeNull()
    }
  })

  it('accepts a direct link to a Google Form, short links included, and nothing else', () => {
    expect(isGoogleFormLink(RESPONDER)).toBe(true)
    expect(isGoogleFormLink('https://forms.gle/abc123')).toBe(true)
    for (const bad of [null, '', 'javascript:alert(1)', 'https://example.org/forms/x', 'https://user:pw@forms.gle/x', 'http://forms.gle/x']) {
      expect(isGoogleFormLink(bad)).toBe(false)
    }
  })
})
