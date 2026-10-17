import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CorrectionNotice, CorrectionsSection, formatCorrectionDate } from '@/components/article/ArticleCorrections'
import type { PublicCorrection } from '@/lib/corrections/types'

const c = (over: Partial<PublicCorrection>): PublicCorrection => ({
  id: 'c1', type: 'CORRECTION', publicNote: 'Note', publishedAt: '2026-10-16T09:00:00.000Z', legacy: false, supersedesId: null, ...over,
})

describe('public correction notices', () => {
  it('formats dates in UK editorial time (a late-evening UTC correction is dated the next day in London summer time)', () => {
    expect(formatCorrectionDate('2026-10-16T23:30:00.000Z')).toBe('17 October 2026')
    expect(formatCorrectionDate('2026-12-16T23:30:00.000Z')).toBe('16 December 2026')
  })

  it('renders nothing when there are no published notices', () => {
    expect(renderToStaticMarkup(<CorrectionNotice corrections={[]} />)).toBe('')
    expect(renderToStaticMarkup(<CorrectionsSection corrections={[]} />)).toBe('')
  })

  it('shows one restrained top notice with label, date and a link to the notes', () => {
    const html = renderToStaticMarkup(<CorrectionNotice corrections={[c({})]} />)
    expect(html).toContain('role="note"')
    expect(html).toContain('<strong')
    expect(html).toContain('Correction')
    expect(html).toContain('<time dateTime="2026-10-16T09:00:00.000Z">16 October 2026</time>')
    expect(html).toContain('This article has been corrected since it was first published.')
    expect(html).toContain('href="#corrections"')
    expect(html).not.toMatch(/has been updated since/)
  })

  it('uses the right verb for clarifications and updates, and counts several notes', () => {
    expect(renderToStaticMarkup(<CorrectionNotice corrections={[c({ type: 'CLARIFICATION' })]} />)).toContain('has been clarified')
    expect(renderToStaticMarkup(<CorrectionNotice corrections={[c({ type: 'UPDATE' })]} />)).toContain('has been updated')
    expect(renderToStaticMarkup(<CorrectionNotice corrections={[c({}), c({ id: 'c2', type: 'UPDATE' })]} />)).toContain('Read the 2 notes')
  })

  it('lists every notice in the given (chronological) order, each with its own label and date', () => {
    const html = renderToStaticMarkup(
      <CorrectionsSection corrections={[
        c({ id: 'a', publicNote: 'First note', publishedAt: '2026-10-16T09:00:00.000Z' }),
        c({ id: 'b', type: 'CLARIFICATION', publicNote: 'Second note', publishedAt: '2026-10-20T09:00:00.000Z' }),
      ]} />,
    )
    expect(html).toContain('id="corrections"')
    expect(html).toContain('id="correction-note"') // older anchor links still land here
    expect(html).toContain('>Corrections</h2>')
    expect(html.indexOf('First note')).toBeLessThan(html.indexOf('Second note'))
    expect(html).toContain('16 October 2026')
    expect(html).toContain('20 October 2026')
    expect(html).toContain('Clarification')
    expect(html).toContain('href="/corrections"')
  })

  it('says a legacy date was not recorded instead of inventing one', () => {
    const html = renderToStaticMarkup(<CorrectionsSection corrections={[c({ legacy: true, publishedAt: null, publicNote: null })]} />)
    expect(html).toContain('Date not recorded')
    expect(html).toContain('the details were not recorded')
  })

  it('links an amendment and the note it amends, in both directions', () => {
    const html = renderToStaticMarkup(<CorrectionsSection corrections={[
      c({ id: 'orig', publicNote: 'Original note' }),
      c({ id: 'amend', supersedesId: 'orig', publicNote: 'Amended note', publishedAt: '2026-10-18T09:00:00.000Z' }),
    ]} />)
    expect(html).toContain('This note amends the correction of 16 October 2026.')
    expect(html).toContain('This note was itself amended on 18 October 2026')
    expect(html).toContain('href="#correction-amend"')
  })

  it('escapes note text: markup in a note is shown as text, never executed', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    const html = renderToStaticMarkup(<CorrectionsSection corrections={[c({ publicNote: hostile })]} />)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })
})
