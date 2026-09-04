import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { GlossaryTermInput } from '@/lib/glossary/linkify'

/**
 * The caching, invalidation and failure behaviour of the translation service.
 *
 * Prisma, the glossary snapshot and the provider are all stubbed, so these
 * tests assert on the decisions the service makes — when it pays for a
 * translation, when it refuses to serve one, what it stores — rather than on
 * any database or network behaviour. The provider stub counts its calls, which
 * is what makes the cost properties testable at all.
 */

interface Row {
  articleId: string
  locale: string
  title: string
  excerpt: string | null
  content: string
  sourceHash: string
  glossaryHash: string
  glossaryTerms: unknown
  provider: string
}

const rows = new Map<string, Row>()
const rowKey = (articleId: string, locale: string) => `${articleId}:${locale}`

vi.mock('@/lib/prisma', () => ({
  prisma: {
    articleTranslation: {
      findUnique: vi.fn(async ({ where }: { where: { articleId_locale: { articleId: string; locale: string } } }) => {
        const { articleId, locale } = where.articleId_locale
        return rows.get(rowKey(articleId, locale)) ?? null
      }),
      upsert: vi.fn(async ({ where, create, update }: {
        where: { articleId_locale: { articleId: string; locale: string } }
        create: Row
        update: Partial<Row>
      }) => {
        const { articleId, locale } = where.articleId_locale
        const key = rowKey(articleId, locale)
        const existing = rows.get(key)
        rows.set(key, existing ? { ...existing, ...update } : { ...create })
        return rows.get(key)
      }),
    },
  },
}))

let glossarySnapshot: { enabled: boolean; terms: GlossaryTermInput[]; fingerprint: string } = {
  enabled: false,
  terms: [],
  fingerprint: 'empty',
}

vi.mock('@/lib/glossary/data', () => ({
  getGlossarySnapshot: vi.fn(async () => glossarySnapshot),
}))

/** Provider stub: records every call and can be made to fail. */
const provider = {
  calls: [] as { texts: string[]; locale: string }[],
  failure: null as Error | null,
  responder: (texts: readonly string[], locale: string) =>
    texts.map((t) => `<${locale}>${t}`),
}

vi.mock('@/lib/translation/deepl', () => ({
  isTranslationConfigured: () => true,
  getConfiguredProvider: () =>
    process.env.__TRANSLATION_UNCONFIGURED === '1'
      ? null
      : {
          name: 'stub',
          async translate(texts: readonly string[], locale: { code: string }) {
            provider.calls.push({ texts: [...texts], locale: locale.code })
            if (provider.failure) throw provider.failure
            return provider.responder(texts, locale.code)
          },
        },
}))

const { getArticleTranslation } = await import('@/lib/translation/service')
const { TARGET_LOCALES } = await import('@/lib/translation/locales')
const { parseStoredGlossaryTerms } = await import('@/lib/translation/glossaryTerms')

const FR = TARGET_LOCALES.find((l) => l.code === 'fr')!
const ES = TARGET_LOCALES.find((l) => l.code === 'es')!

function doc(...paragraphs: string[]): string {
  return JSON.stringify({
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  })
}

function article(overrides: Partial<{ title: string; excerpt: string | null; content: string }> = {}) {
  return {
    articleId: 'article-1',
    title: 'The case for fiscal restraint',
    excerpt: 'Why the deficit matters.',
    content: doc('Output gaps narrowed through the year.'),
    ...overrides,
  }
}

beforeEach(() => {
  rows.clear()
  provider.calls = []
  provider.failure = null
  provider.responder = (texts, locale) => texts.map((t) => `<${locale}>${t}`)
  glossarySnapshot = { enabled: false, terms: [], fingerprint: 'empty' }
  delete process.env.__TRANSLATION_UNCONFIGURED
})

describe('first request', () => {
  it('translates the title, excerpt and body, and stores the result', async () => {
    const result = await getArticleTranslation({ ...article(), locale: FR })

    expect(result.status).toBe('translated')
    if (result.status !== 'translated') return
    expect(result.translation.title).toBe('<fr>The case for fiscal restraint')
    expect(result.translation.excerpt).toBe('<fr>Why the deficit matters.')
    expect(result.translation.content).toContain('<fr>Output gaps narrowed through the year.')
    expect(provider.calls).toHaveLength(1)
    expect(rows.size).toBe(1)
  })

  it('leaves a null excerpt null rather than inventing one', async () => {
    const result = await getArticleTranslation({
      ...article({ excerpt: null }),
      locale: FR,
    })
    expect(result.status === 'translated' && result.translation.excerpt).toBeNull()
  })

  it('renders the stored content through the normal article renderer', async () => {
    const { renderContent } = await import('@/lib/articleRender')
    const result = await getArticleTranslation({ ...article(), locale: FR })
    if (result.status !== 'translated') throw new Error('expected a translation')
    expect(renderContent(result.translation.content).html).toBe(
      '<p>&lt;fr&gt;Output gaps narrowed through the year.</p>'
    )
  })
})

describe('caching', () => {
  it('reuses the stored translation on the second request', async () => {
    await getArticleTranslation({ ...article(), locale: FR })
    await getArticleTranslation({ ...article(), locale: FR })
    expect(provider.calls).toHaveLength(1)
  })

  it('keeps languages separate', async () => {
    await getArticleTranslation({ ...article(), locale: FR })
    await getArticleTranslation({ ...article(), locale: ES })
    expect(provider.calls.map((c) => c.locale)).toEqual(['fr', 'es'])
    expect(rows.size).toBe(2)

    const es = await getArticleTranslation({ ...article(), locale: ES })
    expect(es.status === 'translated' && es.translation.title).toBe(
      '<es>The case for fiscal restraint'
    )
    expect(provider.calls).toHaveLength(2)
  })

  it('shares one provider call between concurrent first requests', async () => {
    const [a, b, c] = await Promise.all([
      getArticleTranslation({ ...article(), locale: FR }),
      getArticleTranslation({ ...article(), locale: FR }),
      getArticleTranslation({ ...article(), locale: FR }),
    ])
    expect(provider.calls).toHaveLength(1)
    expect(a.status).toBe('translated')
    expect(b.status).toBe('translated')
    expect(c.status).toBe('translated')
  })
})

describe('invalidation when the source article changes', () => {
  it('retranslates after the body is edited and never serves the old version', async () => {
    const v1 = await getArticleTranslation({ ...article(), locale: FR })
    expect(v1.status === 'translated' && v1.translation.content).toContain('Output gaps narrowed')

    const edited = article({ content: doc('Output gaps widened sharply instead.') })
    const v2 = await getArticleTranslation({ ...edited, locale: FR })

    expect(provider.calls).toHaveLength(2)
    expect(v2.status === 'translated' && v2.translation.content).toContain(
      '<fr>Output gaps widened sharply instead.'
    )
    expect(v2.status === 'translated' && v2.translation.content).not.toContain('narrowed')
    expect(rows.size).toBe(1)
  })

  it('retranslates after the title changes', async () => {
    await getArticleTranslation({ ...article(), locale: FR })
    await getArticleTranslation({ ...article({ title: 'A different headline' }), locale: FR })
    expect(provider.calls).toHaveLength(2)
  })

  it('does NOT retranslate when nothing translatable changed', async () => {
    await getArticleTranslation({ ...article(), locale: FR })
    // Same translatable payload; in production this is a re-tag, a feature
    // toggle or an engagement-score recompute, all of which bump updatedAt.
    await getArticleTranslation({ ...article(), locale: FR })
    expect(provider.calls).toHaveLength(1)
  })

  it('refuses to serve a translation of superseded content when the provider fails', async () => {
    await getArticleTranslation({ ...article(), locale: FR })
    provider.failure = new Error('provider down')

    const result = await getArticleTranslation({
      ...article({ content: doc('Completely rewritten analysis.') }),
      locale: FR,
    })

    expect(result).toEqual({ status: 'unavailable', reason: 'provider_error' })
  })
})

describe('failure behaviour', () => {
  it('reports unavailable when no provider is configured', async () => {
    process.env.__TRANSLATION_UNCONFIGURED = '1'
    const result = await getArticleTranslation({ ...article(), locale: FR })
    expect(result).toEqual({ status: 'unavailable', reason: 'not_configured' })
    expect(provider.calls).toHaveLength(0)
  })

  it('reports unavailable rather than throwing when the provider errors', async () => {
    provider.failure = new Error('502 Bad Gateway')
    const result = await getArticleTranslation({ ...article(), locale: FR })
    expect(result).toEqual({ status: 'unavailable', reason: 'provider_error' })
  })

  it('rejects a provider response with the wrong number of strings', async () => {
    provider.responder = (texts, locale) => texts.slice(1).map((t) => `<${locale}>${t}`)
    const result = await getArticleTranslation({ ...article(), locale: FR })
    expect(result).toEqual({ status: 'unavailable', reason: 'provider_error' })
    expect(rows.size).toBe(0)
  })

  it('serves a still-current cached translation through a provider outage', async () => {
    await getArticleTranslation({ ...article(), locale: FR })
    provider.failure = new Error('provider down')

    const result = await getArticleTranslation({ ...article(), locale: FR })
    expect(result.status).toBe('translated')
    // The cache hit short-circuits before the provider is consulted at all.
    expect(provider.calls).toHaveLength(1)
  })

  it('rate-limits the generation of new translations per client', async () => {
    const results = []
    for (let i = 0; i < 12; i++) {
      results.push(
        await getArticleTranslation({
          ...article({ content: doc(`Distinct body number ${i}.`) }),
          articleId: `article-${i}`,
          locale: FR,
          clientKey: 'test-abuser',
        })
      )
    }
    const limited = results.filter(
      (r) => r.status === 'unavailable' && r.reason === 'rate_limited'
    )
    expect(limited.length).toBeGreaterThan(0)
    expect(provider.calls.length).toBeLessThan(12)
  })
})

describe('glossary integration', () => {
  const terms: GlossaryTermInput[] = [
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
  ]

  beforeEach(() => {
    glossarySnapshot = { enabled: true, terms, fingerprint: 'v1' }
  })

  it('translates only the terms that occur in the article', async () => {
    const result = await getArticleTranslation({
      ...article({ content: doc('The Bank relied on quantitative easing throughout.') }),
      locale: FR,
    })
    if (result.status !== 'translated') throw new Error('expected a translation')

    const stored = parseStoredGlossaryTerms(result.translation.glossaryTerms)
    expect(stored.map((t) => t.id)).toEqual(['qe'])
    expect(stored[0].term).toBe('<fr>quantitative easing')
    expect(stored[0].definition).toBe(
      '<fr>Central bank purchases of assets to expand the money supply.'
    )
  })

  it('keeps the English surface forms as aliases so untranslated jargon still resolves', async () => {
    const result = await getArticleTranslation({
      ...article({ content: doc('The Bank relied on quantitative easing throughout.') }),
      locale: FR,
    })
    if (result.status !== 'translated') throw new Error('expected a translation')
    const stored = parseStoredGlossaryTerms(result.translation.glossaryTerms)
    expect(stored[0].aliases).toEqual(['quantitative easing', 'QE'])
  })

  it('never sends the learn-more URL to the provider and preserves it verbatim', async () => {
    const result = await getArticleTranslation({
      ...article({ content: doc('The Bank relied on quantitative easing throughout.') }),
      locale: FR,
    })
    if (result.status !== 'translated') throw new Error('expected a translation')
    expect(parseStoredGlossaryTerms(result.translation.glossaryTerms)[0].learnMoreUrl).toBe(
      'https://example.org/qe'
    )
    expect(provider.calls.flatMap((c) => c.texts)).not.toContain('https://example.org/qe')
  })

  it('stores no terms when the glossary feature is switched off', async () => {
    glossarySnapshot = { enabled: false, terms, fingerprint: 'v1' }
    const result = await getArticleTranslation({
      ...article({ content: doc('The Bank relied on quantitative easing throughout.') }),
      locale: FR,
    })
    if (result.status !== 'translated') throw new Error('expected a translation')
    expect(parseStoredGlossaryTerms(result.translation.glossaryTerms)).toEqual([])
  })

  it('refreshes definitions after a glossary edit without repaying for the body', async () => {
    const input = {
      ...article({ content: doc('The Bank relied on quantitative easing throughout.') }),
      locale: FR,
    }
    await getArticleTranslation(input)
    // The first call carries the article and its glossary in one ordered payload.
    expect(provider.calls[0].texts).toEqual([
      'The case for fiscal restraint',
      'Why the deficit matters.',
      'The Bank relied on quantitative easing throughout.',
      'quantitative easing',
      'Central bank purchases of assets to expand the money supply.',
    ])

    glossarySnapshot = {
      enabled: true,
      terms: [{ ...terms[0], definition: 'A revised definition of the policy.' }, terms[1]],
      fingerprint: 'v2',
    }

    const refreshed = await getArticleTranslation(input)
    if (refreshed.status !== 'translated') throw new Error('expected a translation')

    expect(provider.calls).toHaveLength(2)
    // The second call carries only the glossary strings, not the article body.
    expect(provider.calls[1].texts).toEqual([
      'quantitative easing',
      'A revised definition of the policy.',
    ])
    expect(parseStoredGlossaryTerms(refreshed.translation.glossaryTerms)[0].definition).toBe(
      '<fr>A revised definition of the policy.'
    )
    // The body translation on the row is the one already paid for.
    expect(refreshed.translation.content).toContain('<fr>The Bank relied on quantitative easing')
  })

  it('does not invalidate an article when an unrelated glossary term changes', async () => {
    const input = {
      ...article({ content: doc('The Bank relied on quantitative easing throughout.') }),
      locale: FR,
    }
    await getArticleTranslation(input)

    glossarySnapshot = {
      enabled: true,
      terms: [terms[0], { ...terms[1], definition: 'A different inequality measure.' }],
      fingerprint: 'v3',
    }

    await getArticleTranslation(input)
    expect(provider.calls).toHaveLength(1)
  })
})
