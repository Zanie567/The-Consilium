import { describe, it, expect } from 'vitest'
import { renderContent, type TiptapNode } from '@/lib/articleRender'
import { extractTranslatable } from '@/lib/translation/tiptapText'
import {
  applyGlossaryTranslations,
  glossaryTranslationStrings,
  matchedGlossaryTerms,
  parseStoredGlossaryTerms,
} from '@/lib/translation/glossaryTerms'
import { buildGlossaryMatcher, linkifyGlossaryTerms, type GlossaryTermInput } from '@/lib/glossary/linkify'

/**
 * Definitions on a translated article.
 *
 * The whole pipeline is exercised end to end with a stubbed translator, from
 * the English document through to the linkified translated HTML, because the
 * failure this guards against is silent: an English-only matcher run against a
 * French body simply matches nothing, and every definition disappears without
 * an error anywhere.
 */

const TERMS: GlossaryTermInput[] = [
  {
    id: 'qe',
    term: 'quantitative easing',
    aliases: ['QE'],
    definition: 'Central bank purchases of assets to expand the money supply.',
    learnMoreUrl: 'https://example.org/qe',
  },
  {
    id: 'gini',
    term: 'Gini coefficient',
    aliases: [],
    definition: 'A summary measure of income inequality.',
    learnMoreUrl: null,
  },
  {
    id: 'nairu',
    term: 'NAIRU',
    aliases: [],
    definition: 'The unemployment rate consistent with stable inflation.',
    learnMoreUrl: null,
  },
]

/** French renderings, as a real provider would return them. */
const FRENCH: Record<string, string> = {
  'The Bank turned to quantitative easing once rates hit the floor.':
    "La Banque s'est tournée vers l'assouplissement quantitatif une fois les taux au plancher.",
  'Inequality, measured by the Gini coefficient, barely moved.':
    "L'inégalité, mesurée par le coefficient de Gini, a à peine bougé.",
  'quantitative easing': 'assouplissement quantitatif',
  'Central bank purchases of assets to expand the money supply.':
    "Achats d'actifs par la banque centrale pour accroître la masse monétaire.",
  'Gini coefficient': 'coefficient de Gini',
  'A summary measure of income inequality.':
    "Une mesure synthétique de l'inégalité des revenus.",
}

function translate(strings: readonly string[]): string[] {
  return strings.map((s) => FRENCH[s] ?? `[fr] ${s}`)
}

function articleDoc(): TiptapNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'The Bank turned to quantitative easing once rates hit the floor.' },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Inequality, measured by the Gini coefficient, barely moved.' },
        ],
      },
    ],
  }
}

/** Reproduces the render path the article page takes for a translated body. */
function renderTranslated() {
  const extracted = extractTranslatable(articleDoc())
  const matched = matchedGlossaryTerms(TERMS, extracted.strings)
  const translatedTerms = applyGlossaryTranslations(
    matched,
    translate(glossaryTranslationStrings(matched))
  )
  const { html } = renderContent(JSON.stringify(extracted.rebuild(translate(extracted.strings))))
  return {
    matched,
    translatedTerms,
    html,
    linkified: linkifyGlossaryTerms(html, buildGlossaryMatcher(translatedTerms)),
  }
}

describe('matching terms in the source article', () => {
  it('selects only the terms the article actually uses', () => {
    const { matched } = renderTranslated()
    expect(matched.map((t) => t.id)).toEqual(['qe', 'gini'])
  })

  it('does not match a term that appears nowhere in the article', () => {
    const { matched } = renderTranslated()
    expect(matched.map((t) => t.id)).not.toContain('nairu')
  })

  it('matches on word boundaries rather than substrings', () => {
    expect(matchedGlossaryTerms(TERMS, ['The NAIRU was revised upwards.']).map((t) => t.id)).toEqual([
      'nairu',
    ])
    expect(matchedGlossaryTerms(TERMS, ['A NAIRUesque argument.'])).toEqual([])
  })

  it('inflects ordinary nouns but never acronyms, matching the existing matcher', () => {
    // buildGlossaryMatcher generates regular plurals only for surface forms
    // ending in a lowercase letter, so "Gini coefficients" resolves while
    // "NAIRUs" deliberately does not. Asserted here so translation inherits
    // exactly the English matching behaviour rather than a second dialect of it.
    expect(
      matchedGlossaryTerms(TERMS, ['Two Gini coefficients were reported.']).map((t) => t.id)
    ).toEqual(['gini'])
    expect(matchedGlossaryTerms(TERMS, ['The NAIRUs of the 1980s.'])).toEqual([])
  })
})

describe('definitions on the translated article', () => {
  it('links the translated surface form in the translated body', () => {
    const { linkified } = renderTranslated()
    expect(linkified).toContain('class="glossary-term"')
    expect(linkified).toContain('>assouplissement quantitatif</span>')
    expect(linkified).toContain('>coefficient de Gini</span>')
  })

  it('carries the translated definition into the tooltip attribute', () => {
    const { linkified } = renderTranslated()
    expect(linkified).toContain(
      'data-gloss-def="Achats d&#39;actifs par la banque centrale pour accroître la masse monétaire."'
    )
  })

  it('keeps the learn-more URL untranslated and intact', () => {
    const { linkified } = renderTranslated()
    expect(linkified).toContain('data-gloss-url="https://example.org/qe"')
  })

  it('would have linked nothing had the English terms been used, which is the bug this prevents', () => {
    const { html } = renderTranslated()
    const englishMatcher = buildGlossaryMatcher(TERMS)
    expect(linkifyGlossaryTerms(html, englishMatcher)).toBe(html)
  })

  it('still resolves a term the provider left in English', () => {
    const terms = applyGlossaryTranslations(
      [TERMS[0]],
      // A provider that returns the English term unchanged, as happens with
      // jargon that is used untranslated in the target language.
      ['quantitative easing', 'Achats d’actifs par la banque centrale.']
    )
    const html = '<p>La Banque a utilisé le quantitative easing pendant dix ans.</p>'
    const linkified = linkifyGlossaryTerms(html, buildGlossaryMatcher(terms))
    expect(linkified).toContain('class="glossary-term"')
    expect(linkified).toContain('>quantitative easing</span>')
  })

  it('does not corrupt the surrounding translated text', () => {
    const { linkified } = renderTranslated()
    // Stripping the injected spans must return the body exactly as rendered.
    const stripped = linkified.replace(/<span class="glossary-term"[^>]*>|<\/span>/g, '')
    expect(stripped).toBe(renderTranslated().html)
  })

  it('leaves the body untouched when the article uses no glossary term', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rien à signaler ici.' }] }],
    }
    const { html } = renderContent(JSON.stringify(doc))
    const matched = matchedGlossaryTerms(TERMS, ['Nothing to report here.'])
    expect(matched).toEqual([])
    expect(linkifyGlossaryTerms(html, buildGlossaryMatcher([]))).toBe(html)
  })
})

describe('stored glossary payload', () => {
  it('round-trips through JSON storage', () => {
    const { translatedTerms } = renderTranslated()
    const roundTripped = parseStoredGlossaryTerms(JSON.parse(JSON.stringify(translatedTerms)))
    expect(roundTripped).toEqual(translatedTerms)
  })

  it('discards malformed rows rather than throwing', () => {
    expect(parseStoredGlossaryTerms(null)).toEqual([])
    expect(parseStoredGlossaryTerms('nonsense')).toEqual([])
    expect(parseStoredGlossaryTerms([{ id: 'x' }, 42, null])).toEqual([])
  })

  it('rejects a provider response of the wrong length', () => {
    expect(() => applyGlossaryTranslations(TERMS, ['only', 'two'])).toThrow(/slot mismatch/)
  })

  it('falls back to the English term if the provider returns an empty string', () => {
    const terms = applyGlossaryTranslations([TERMS[0]], ['   ', 'Une définition.'])
    expect(terms[0].term).toBe('quantitative easing')
  })
})
