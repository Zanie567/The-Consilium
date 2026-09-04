import { describe, it, expect } from 'vitest'
import {
  extractTranslatable,
  isTranslatableString,
  parseArticleDocument,
} from '@/lib/translation/tiptapText'
import { renderContent, type TiptapNode } from '@/lib/articleRender'
import { sourceContentHash, glossaryPayloadHash } from '@/lib/translation/hash'
import { batchTexts, deeplApiBase, DEEPL_MAX_TEXTS_PER_REQUEST } from '@/lib/translation/deepl'
import {
  resolveTargetLocale,
  isTargetLocale,
  TARGET_LOCALES,
  SOURCE_LOCALE,
} from '@/lib/translation/locales'

/**
 * The content half of article translation: what is extracted, what is left
 * alone, and what happens when the two halves are put back together.
 *
 * The load-bearing property under test is that translation is a leaf-string
 * substitution on a structured document. Anything the extractor does not
 * collect is, by construction, impossible for the provider to alter — so these
 * tests assert on the shape of the rebuilt document, not just its text.
 */

/** A document exercising every structural feature the renderer supports. */
function sampleDoc(): TiptapNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Monetary policy after the shock' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Inflation fell to ' },
          { type: 'text', text: '2.1%', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' in the year to March, according to the ' },
          {
            type: 'text',
            text: 'Office for National Statistics',
            marks: [{ type: 'link', attrs: { href: 'https://www.ons.gov.uk/economy', target: '_blank' } }],
          },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rates held steady.' }] }],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'The committee voted seven to two.' }] },
        ],
      },
      {
        type: 'figure',
        attrs: {
          src: 'https://example.supabase.co/storage/chart.png',
          alt: 'Line chart of CPI inflation',
          caption: 'CPI inflation, 2020 to 2024',
          credit: 'Bank of England',
        },
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'The path back to target remains uncertain.' },
          { type: 'footnoteRef', attrs: { content: 'See the February Monetary Policy Report.' } },
        ],
      },
      {
        type: 'pullQuote',
        content: [{ type: 'text', text: 'Disinflation is not the same as deflation.' }],
      },
    ],
  }
}

/** Deterministic stand-in for a provider: marks each string as translated. */
function fakeTranslate(strings: readonly string[]): string[] {
  return strings.map((s) => `[fr] ${s}`)
}

describe('isTranslatableString', () => {
  it('accepts ordinary prose', () => {
    expect(isTranslatableString('Inflation fell to target.')).toBe(true)
  })

  it('rejects strings with no letters, which cost quota and can only be damaged', () => {
    expect(isTranslatableString('2.1%')).toBe(false)
    expect(isTranslatableString('   ')).toBe(false)
    expect(isTranslatableString('—')).toBe(false)
    expect(isTranslatableString('2020-2024')).toBe(false)
  })

  it('still translates quantities carrying a unit, which are localised not corrupted', () => {
    // "£1.2bn" has letters, so it goes to the provider and comes back as
    // "1,2 Mrd. £" in German. That is correct localisation of the magnitude
    // suffix, not numeric corruption, and suppressing it would leave an English
    // "bn" stranded mid-sentence.
    expect(isTranslatableString('£1.2bn')).toBe(true)
  })

  it('rejects bare URLs and email addresses so citations survive intact', () => {
    expect(isTranslatableString('https://www.ons.gov.uk/economy')).toBe(false)
    expect(isTranslatableString('www.bankofengland.co.uk')).toBe(false)
    expect(isTranslatableString('editor@theconsilium.co.uk')).toBe(false)
  })

  it('still translates prose that merely contains a URL', () => {
    expect(isTranslatableString('See https://www.ons.gov.uk for the series.')).toBe(true)
  })
})

describe('extractTranslatable', () => {
  it('collects body text, headings, captions, credits, alt text and footnotes', () => {
    const { strings } = extractTranslatable(sampleDoc())
    expect(strings).toContain('Monetary policy after the shock')
    expect(strings).toContain('Inflation fell to ')
    expect(strings).toContain('Rates held steady.')
    expect(strings).toContain('The committee voted seven to two.')
    expect(strings).toContain('CPI inflation, 2020 to 2024')
    expect(strings).toContain('Bank of England')
    expect(strings).toContain('Line chart of CPI inflation')
    expect(strings).toContain('See the February Monetary Policy Report.')
    expect(strings).toContain('Disinflation is not the same as deflation.')
  })

  it('never collects URLs, image sources or numeric-only runs', () => {
    const { strings } = extractTranslatable(sampleDoc())
    expect(strings).not.toContain('https://www.ons.gov.uk/economy')
    expect(strings).not.toContain('https://example.supabase.co/storage/chart.png')
    expect(strings).not.toContain('2.1%')
    expect(strings.some((s) => s.includes('supabase.co'))).toBe(false)
  })

  it('does not mutate the input document', () => {
    const doc = sampleDoc()
    const before = JSON.stringify(doc)
    extractTranslatable(doc).rebuild(fakeTranslate(extractTranslatable(doc).strings))
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('rejects a provider response with the wrong number of strings', () => {
    const extracted = extractTranslatable(sampleDoc())
    expect(() => extracted.rebuild(['only one'])).toThrow(/slot mismatch/)
  })
})

describe('rebuilt document', () => {
  const extracted = extractTranslatable(sampleDoc())
  const rebuilt = extracted.rebuild(fakeTranslate(extracted.strings))
  const { html, footnotes } = renderContent(JSON.stringify(rebuilt))

  it('preserves headings', () => {
    expect(html).toContain('<h2>[fr] Monetary policy after the shock</h2>')
  })

  it('preserves links with their href untouched', () => {
    expect(html).toContain('href="https://www.ons.gov.uk/economy"')
    expect(html).toContain('[fr] Office for National Statistics')
  })

  it('preserves emphasis marks around translated text', () => {
    expect(html).toContain('<strong>2.1%</strong>')
  })

  it('preserves lists and blockquotes rather than flattening to paragraphs', () => {
    expect(html).toContain('<ul><li><p>[fr] Rates held steady.</p></li></ul>')
    expect(html).toContain('<blockquote><p>[fr] The committee voted seven to two.</p></blockquote>')
  })

  it('preserves images while translating their caption, credit and alt text', () => {
    expect(html).toContain('src="https://example.supabase.co/storage/chart.png"')
    expect(html).toContain('alt="[fr] Line chart of CPI inflation"')
    expect(html).toContain('<figcaption class="caption">[fr] CPI inflation, 2020 to 2024</figcaption>')
    expect(html).toContain('<p class="image-credit">[fr] Bank of England</p>')
  })

  it('preserves pull quotes', () => {
    expect(html).toContain('data-type="pull-quote"')
    expect(html).toContain('[fr] Disinflation is not the same as deflation.')
  })

  it('translates footnote text and keeps marker numbering intact', () => {
    expect(footnotes).toEqual([
      { index: 1, content: '[fr] See the February Monetary Policy Report.' },
    ])
    expect(html).toContain('id="fnref-1"')
  })

  it('produces the same node structure as the English document', () => {
    const strip = (node: TiptapNode): unknown => ({
      type: node.type,
      attrs: node.attrs ? Object.keys(node.attrs).sort() : undefined,
      marks: node.marks?.map((m) => m.type),
      content: node.content?.map(strip),
    })
    expect(strip(rebuilt)).toEqual(strip(sampleDoc()))
  })
})

describe('malformed content', () => {
  it('returns null for content that is not a TipTap document', () => {
    expect(parseArticleDocument('not json at all')).toBeNull()
    expect(parseArticleDocument('{"type":"paragraph"}')).toBeNull()
    expect(parseArticleDocument('[]')).toBeNull()
  })

  it('renders a document containing unknown node types without throwing', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'somethingNew', content: [{ type: 'text', text: 'Still readable.' }] },
      ],
    }
    const extracted = extractTranslatable(doc)
    expect(extracted.strings).toEqual(['Still readable.'])
    const { html } = renderContent(JSON.stringify(extracted.rebuild(['Toujours lisible.'])))
    expect(html).toContain('Toujours lisible.')
  })
})

describe('source content hash', () => {
  const base = { title: 'A', excerpt: 'B', strings: ['one', 'two'] }

  it('is stable for identical input', () => {
    expect(sourceContentHash(base)).toBe(sourceContentHash({ ...base }))
  })

  it('changes when the title, excerpt or body text changes', () => {
    expect(sourceContentHash({ ...base, title: 'A2' })).not.toBe(sourceContentHash(base))
    expect(sourceContentHash({ ...base, excerpt: 'B2' })).not.toBe(sourceContentHash(base))
    expect(sourceContentHash({ ...base, strings: ['one', 'three'] })).not.toBe(
      sourceContentHash(base)
    )
  })

  it('distinguishes a null excerpt from an empty one only by content, not identity', () => {
    expect(sourceContentHash({ ...base, excerpt: null })).toBe(
      sourceContentHash({ ...base, excerpt: '' })
    )
  })

  it('cannot be collided by shifting a boundary between adjacent strings', () => {
    expect(sourceContentHash({ ...base, strings: ['ab', 'c'] })).not.toBe(
      sourceContentHash({ ...base, strings: ['a', 'bc'] })
    )
  })
})

describe('glossary payload hash', () => {
  const t = (id: string, definition: string) => ({ id, term: id, definition, learnMoreUrl: null })

  it('ignores ordering', () => {
    expect(glossaryPayloadHash([t('a', 'x'), t('b', 'y')])).toBe(
      glossaryPayloadHash([t('b', 'y'), t('a', 'x')])
    )
  })

  it('changes when a definition changes', () => {
    expect(glossaryPayloadHash([t('a', 'x')])).not.toBe(glossaryPayloadHash([t('a', 'z')]))
  })

  it('has a distinct value for the empty set', () => {
    expect(glossaryPayloadHash([])).toBe('none')
  })
})

describe('locale allowlist', () => {
  it('resolves each supported language', () => {
    for (const locale of TARGET_LOCALES) {
      expect(resolveTargetLocale(locale.code)?.code).toBe(locale.code)
    }
  })

  it('enables exactly French, Spanish, German and Simplified Chinese', () => {
    expect(TARGET_LOCALES.map((l) => l.code)).toEqual(['fr', 'es', 'de', 'zh'])
  })

  it('uses the DeepL target codes from the provider documentation', () => {
    expect(TARGET_LOCALES.map((l) => l.deeplTarget)).toEqual(['FR', 'ES', 'DE', 'ZH-HANS'])
  })

  it('rejects English, which is the canonical source and is never translated', () => {
    expect(resolveTargetLocale(SOURCE_LOCALE)).toBeNull()
    expect(resolveTargetLocale('EN')).toBeNull()
  })

  it('rejects arbitrary, injected and repeated locale values', () => {
    expect(resolveTargetLocale('jp')).toBeNull()
    expect(resolveTargetLocale('fr-CA')).toBeNull()
    expect(resolveTargetLocale('FR&formality=less')).toBeNull()
    expect(resolveTargetLocale('../../etc/passwd')).toBeNull()
    expect(resolveTargetLocale(['fr', 'es'])).toBeNull()
    expect(resolveTargetLocale(undefined)).toBeNull()
    expect(resolveTargetLocale(null)).toBeNull()
    expect(resolveTargetLocale(42)).toBeNull()
    expect(isTargetLocale('ru')).toBe(false)
  })

  it('accepts case and whitespace variations of a supported code', () => {
    expect(resolveTargetLocale(' FR ')?.code).toBe('fr')
  })
})

describe('DeepL request shaping', () => {
  it('routes free keys to the free host and everything else to the pro host', () => {
    expect(deeplApiBase('abc-123:fx')).toBe('https://api-free.deepl.com')
    expect(deeplApiBase('abc-123')).toBe('https://api.deepl.com')
  })

  it('never exceeds the documented 50 texts per request', () => {
    const texts = Array.from({ length: 137 }, (_, i) => `sentence ${i}`)
    const batches = batchTexts(texts)
    expect(batches.flat()).toEqual(texts)
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(DEEPL_MAX_TEXTS_PER_REQUEST)
    }
  })

  it('splits on the byte budget before the count limit for very long strings', () => {
    const long = 'x'.repeat(80 * 1024)
    const batches = batchTexts([long, long, long])
    expect(batches.length).toBe(3)
    expect(batches.flat()).toHaveLength(3)
  })

  it('returns no batches for no input', () => {
    expect(batchTexts([])).toEqual([])
  })
})
