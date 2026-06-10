import { describe, it, expect } from 'vitest'
import {
  buildGlossaryMatcher,
  linkifyGlossaryTerms,
  type GlossaryTermInput,
} from '@/lib/glossary/linkify'
import { sanitizeArticleHtml } from '@/lib/articleSanitize'

/**
 * The linkifier runs server-side on the OUTPUT of sanitizeArticleHtml and
 * wraps the first occurrence of each active glossary term in a tooltip
 * trigger span. These tests exercise the real matcher and linkifier against
 * the exact failure modes that matter: matching inside markup it must never
 * touch, substring and overlap handling, first-occurrence-only linking, and
 * byte-identical output when nothing matches.
 */

function term(t: string, overrides: Partial<GlossaryTermInput> = {}): GlossaryTermInput {
  return {
    id: `id-${t}`,
    term: t,
    aliases: [],
    definition: `Definition of ${t}.`,
    learnMoreUrl: null,
    ...overrides,
  }
}

function matcherFor(terms: GlossaryTermInput[]) {
  return buildGlossaryMatcher(terms)
}

function linkify(html: string, terms: GlossaryTermInput[]) {
  return linkifyGlossaryTerms(html, matcherFor(terms))
}

describe('glossary linkifier', () => {
  it('wraps a term in a plain paragraph with the tooltip trigger', () => {
    const out = linkify('<p>The Bank used quantitative easing in 2020.</p>', [
      term('quantitative easing'),
    ])
    expect(out).toBe(
      '<p>The Bank used <span class="glossary-term" data-gloss-term="quantitative easing"' +
        ' data-gloss-def="Definition of quantitative easing.">quantitative easing</span> in 2020.</p>'
    )
  })

  it('does not match inside an existing <a>', () => {
    const html = '<p><a href="https://example.com">quantitative easing</a> explained.</p>'
    expect(linkify(html, [term('quantitative easing')])).toBe(html)
  })

  it('does not match inside headings', () => {
    const html = '<h2>Quantitative easing</h2><h3>More quantitative easing</h3>'
    expect(linkify(html, [term('quantitative easing')])).toBe(html)
  })

  it('does not match inside code or pre blocks', () => {
    const html = '<pre><code>inflation = 2</code></pre><code>inflation</code>'
    expect(linkify(html, [term('inflation')])).toBe(html)
  })

  it('does not match inside blockquotes, pull quotes, captions, or footnote refs', () => {
    const html =
      '<blockquote><p>inflation is theft</p></blockquote>' +
      '<aside data-type="pull-quote" class="pull-quote">inflation soared</aside>' +
      '<figure class="article-figure"><img src="https://x.supabase.co/a.png" alt="inflation" />' +
      '<figcaption class="caption">inflation over time</figcaption></figure>' +
      '<sup class="footnote-ref" data-footnote="inflation" data-index="1" title="inflation">[1]</sup>'
    expect(linkify(html, [term('inflation')])).toBe(html)
  })

  it('never matches inside tag names or attribute values', () => {
    const html = '<p class="marker">text without the m word</p>'
    expect(linkify(html, [term('mark'), term('marker'), term('class')])).toBe(html)
  })

  it('does not match a term that is a substring of a longer word', () => {
    const html = '<p>The internalisation of costs is not the same thing.</p>'
    expect(linkify(html, [term('inter')])).toBe(html)
    expect(linkify('<p>Reflation is different.</p>', [term('inflation')])).toBe(
      '<p>Reflation is different.</p>'
    )
  })

  it('prefers the longest term when terms overlap', () => {
    const out = linkify('<p>The Phillips curve flattened.</p>', [
      term('curve'),
      term('Phillips curve'),
    ])
    expect(out).toContain('data-gloss-term="Phillips curve"')
    expect(out).toContain('>Phillips curve</span>')
    // The shorter term must not be wrapped inside or around the longer match.
    expect(out).not.toContain('data-gloss-term="curve"')
  })

  it('links only the first occurrence of a term', () => {
    const out = linkify('<p>Inflation rose. Inflation then fell. inflation again.</p>', [
      term('inflation'),
    ])
    expect(out.match(/glossary-term/g)).toHaveLength(1)
    expect(out).toContain('>Inflation</span> rose. Inflation then fell. inflation again.')
  })

  it('counts an alias hit as the first occurrence of its term', () => {
    const out = linkify('<p>QE began. Later, quantitative easing ended.</p>', [
      term('quantitative easing', { aliases: ['QE'] }),
    ])
    expect(out.match(/glossary-term/g)).toHaveLength(1)
    expect(out).toContain('>QE</span> began.')
    // The tooltip names the canonical term even when an alias matched.
    expect(out).toContain('data-gloss-term="quantitative easing"')
  })

  it('matches case-insensitively and preserves the article casing', () => {
    const out = linkify('<p>QUANTITATIVE Easing worked.</p>', [term('quantitative easing')])
    expect(out).toContain('>QUANTITATIVE Easing</span>')
  })

  it('matches regular plurals and leaves possessives outside the wrap', () => {
    const out = linkify('<p>Negative externalities abound.</p>', [term('externality')])
    expect(out).toContain('data-gloss-term="externality"')
    expect(out).toContain('>externalities</span>')

    const fed = linkify("<p>It was the Fed's call.</p>", [term('the Fed')])
    expect(fed).toContain(">the Fed</span>'s call.")
  })

  it('does not invent plurals for acronyms', () => {
    expect(linkify('<p>The GDPs of both nations.</p>', [term('GDP')])).toBe(
      '<p>The GDPs of both nations.</p>'
    )
  })

  it('handles HTML entities adjacent to the term', () => {
    const out = linkify('<p>Fiscal &amp; monetary policy &lt;works&gt;.</p>', [
      term('monetary policy'),
    ])
    expect(out).toContain('&amp; <span')
    expect(out).toContain('>monetary policy</span> &lt;works&gt;.')
    // Entity text itself is never matched ("amp" is not the term "amp").
    expect(linkify('<p>A &amp; B</p>', [term('amp')])).toBe('<p>A &amp; B</p>')
  })

  it('returns the input unchanged for an empty glossary', () => {
    expect(buildGlossaryMatcher([])).toBeNull()
    const html = '<p>Inflation everywhere.</p>'
    expect(linkifyGlossaryTerms(html, null)).toBe(html)
  })

  it('returns byte-identical output when nothing matches', () => {
    const html =
      '<p>Plain paragraph with &amp; entities, <strong>markup</strong>, and ' +
      '<a href="https://example.com" target="_blank" rel="noopener">links</a>.</p>' +
      '<h2>A heading</h2><ul><li>item</li></ul>'
    const out = linkifyGlossaryTerms(html, matcherFor([term('quantitative easing')]))
    expect(out).toBe(html)
  })

  it('escapes definitions and drops unsafe learn more URLs', () => {
    const out = linkify('<p>Moral hazard everywhere.</p>', [
      term('moral hazard', {
        definition: 'Risk-taking when someone else pays. "Quotes" & <angles>.',
        learnMoreUrl: 'javascript:alert(1)',
      }),
    ])
    expect(out).toContain(
      'data-gloss-def="Risk-taking when someone else pays. &quot;Quotes&quot; &amp; &lt;angles&gt;."'
    )
    expect(out).not.toContain('data-gloss-url')
    expect(out).not.toContain('javascript:')

    const safe = linkify('<p>Moral hazard everywhere.</p>', [
      term('moral hazard', { learnMoreUrl: 'https://example.com/mh' }),
    ])
    expect(safe).toContain('data-gloss-url="https://example.com/mh"')
  })

  it('injected markup survives sanitizeArticleHtml unchanged', () => {
    const linked = linkify('<p>Inflation rose.</p>', [
      term('inflation', { learnMoreUrl: 'https://example.com' }),
    ])
    expect(sanitizeArticleHtml(linked)).toBe(linked)
  })

  it('sanitizer strips spans that are not glossary triggers', () => {
    const out = sanitizeArticleHtml('<p><span class="evil" onclick="x()">text</span></p>')
    expect(out).toBe('<p><span>text</span></p>')
  })
})
