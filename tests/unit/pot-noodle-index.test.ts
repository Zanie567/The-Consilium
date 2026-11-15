import { describe, expect, it } from 'vitest'
import { POT_NOODLE_INDEX, formatPence, latestChange, publishableResults, type PublishedResults } from '@/lib/potNoodleIndex'
import { googleFormEmbedUrl, isGoogleFormLink } from '@/lib/googleForms'

const VALID: PublishedResults = {
  published: true,
  updatedAt: '2027-02-01',
  collectedFrom: '2026-11-20',
  collectedTo: '2027-01-31',
  responses: 240,
  minimumRegionResponses: 20,
  series: [{ date: '2026-12-31', pence: 120 }, { date: '2027-01-31', pence: 126 }],
  regions: [{ name: 'Edinburgh', pence: 125, responses: 80 }],
  methodology: ['Prices are for a single standard pot.'],
}

describe('the Pot Noodle Index config', () => {
  it('ships with no form URL and no results: nothing is invented', () => {
    expect(POT_NOODLE_INDEX.form.responderUrl).toBeNull()
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
    ['a zero or negative price', { series: [{ date: '2027-01-31', pence: 0 }] }],
    ['dates out of order', { series: [{ date: '2027-01-31', pence: 120 }, { date: '2026-12-31', pence: 126 }] }],
    ['an invalid date', { updatedAt: '31/01/2027' }],
    ['collection ending before it starts', { collectedFrom: '2027-02-01', collectedTo: '2027-01-01' }],
    ['no responses', { responses: 0 }],
    ['a region below its own minimum', { regions: [{ name: 'Glasgow', pence: 120, responses: 5 }] }],
    ['an unnamed region', { regions: [{ name: ' ', pence: 120, responses: 50 }] }],
  ])('withholds everything when there is %s', (_label, change) => {
    expect(publishableResults({ ...VALID, ...change })).toBeNull()
  })

  it('formats and compares prices', () => {
    expect(formatPence(126)).toBe('£1.26')
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
