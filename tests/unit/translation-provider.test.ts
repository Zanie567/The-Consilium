import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDeeplProvider } from '@/lib/translation/deepl'
import { TranslationProviderError } from '@/lib/translation/provider'
import { TARGET_LOCALES } from '@/lib/translation/locales'
import { extractTranslatable } from '@/lib/translation/tiptapText'
import { renderContent, type TiptapNode } from '@/lib/articleRender'

/**
 * The provider boundary: what leaves the server, what is accepted back, and
 * what happens to hostile output.
 *
 * `fetch` is stubbed throughout, so no request reaches DeepL. The request the
 * client would have sent is captured and asserted against the documented API,
 * which is what catches an invented parameter or a wrong language code without
 * spending quota to find out.
 */

const FR = TARGET_LOCALES.find((l) => l.code === 'fr')!
const ZH = TARGET_LOCALES.find((l) => l.code === 'zh')!
const KEY = 'test-key-0000-1111:fx'

let captured: { url: string; init: RequestInit }[] = []

function stubFetch(response: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    captured.push({ url, init })
    return response()
  }))
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function bodyOf(index = 0): URLSearchParams {
  return captured[index].init.body as URLSearchParams
}

beforeEach(() => {
  captured = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request construction', () => {
  beforeEach(() => {
    stubFetch(() =>
      jsonResponse({ translations: [{ text: 'Un', detected_source_language: 'EN' }] })
    )
  })

  it('sends English as the explicit source language', async () => {
    await createDeeplProvider(KEY).translate(['One'], FR)
    expect(bodyOf().get('source_lang')).toBe('EN')
  })

  it('sends the documented target code for each supported language', async () => {
    await createDeeplProvider(KEY).translate(['One'], FR)
    expect(bodyOf(0).get('target_lang')).toBe('FR')
    await createDeeplProvider(KEY).translate(['One'], ZH)
    expect(bodyOf(1).get('target_lang')).toBe('ZH-HANS')
  })

  it('authenticates with the DeepL-Auth-Key header and nothing else', async () => {
    await createDeeplProvider(KEY).translate(['One'], FR)
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`DeepL-Auth-Key ${KEY}`)
    // The key must never travel in the URL, where it would land in access logs.
    expect(captured[0].url).not.toContain(KEY)
    expect(bodyOf().toString()).not.toContain(KEY)
  })

  it('routes a free key to the free host', async () => {
    await createDeeplProvider(KEY).translate(['One'], FR)
    expect(captured[0].url).toBe('https://api-free.deepl.com/v2/translate')
  })

  it('never enables tag handling, because only plain text is ever sent', async () => {
    await createDeeplProvider(KEY).translate(['One'], FR)
    expect(bodyOf().get('tag_handling')).toBeNull()
  })

  it('uses the prefixed formality value so Chinese does not fail the request', async () => {
    await createDeeplProvider(KEY).translate(['One'], ZH)
    expect(bodyOf().get('formality')).toBe('prefer_more')
  })

  it('makes no request at all for an empty payload', async () => {
    const result = await createDeeplProvider(KEY).translate([], FR)
    expect(result).toEqual([])
    expect(captured).toHaveLength(0)
  })
})

describe('response handling', () => {
  it('returns translations in request order', async () => {
    stubFetch(() =>
      jsonResponse({
        translations: [{ text: 'Un' }, { text: 'Deux' }, { text: 'Trois' }],
      })
    )
    const result = await createDeeplProvider(KEY).translate(['One', 'Two', 'Three'], FR)
    expect(result).toEqual(['Un', 'Deux', 'Trois'])
  })

  it('rejects a response with fewer translations than inputs', async () => {
    stubFetch(() => jsonResponse({ translations: [{ text: 'Un' }] }))
    await expect(createDeeplProvider(KEY).translate(['One', 'Two'], FR)).rejects.toMatchObject({
      kind: 'malformed_response',
    })
  })

  it('rejects a response whose entries have no text field', async () => {
    stubFetch(() => jsonResponse({ translations: [{ detected_source_language: 'EN' }] }))
    await expect(createDeeplProvider(KEY).translate(['One'], FR)).rejects.toMatchObject({
      kind: 'malformed_response',
    })
  })

  it('rejects a non-JSON body', async () => {
    stubFetch(() => new Response('<html>gateway error</html>', { status: 200 }))
    await expect(createDeeplProvider(KEY).translate(['One'], FR)).rejects.toMatchObject({
      kind: 'malformed_response',
    })
  })

  it('rejects a body that is JSON but not the documented shape', async () => {
    stubFetch(() => jsonResponse({ result: 'ok' }))
    await expect(createDeeplProvider(KEY).translate(['One'], FR)).rejects.toMatchObject({
      kind: 'malformed_response',
    })
  })
})

describe('error classification', () => {
  const cases: [number, string][] = [
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [456, 'quota'],
    [400, 'unsupported_language'],
    [500, 'provider_error'],
    [503, 'provider_error'],
  ]

  for (const [status, kind] of cases) {
    it(`maps HTTP ${status} to ${kind}`, async () => {
      stubFetch(() => jsonResponse({ message: 'upstream detail' }, status))
      await expect(createDeeplProvider(KEY).translate(['One'], FR)).rejects.toMatchObject({
        kind,
        status,
      })
    })
  }

  it('reports a network failure without leaking the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const error = await createDeeplProvider(KEY)
      .translate(['One'], FR)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TranslationProviderError)
    expect((error as Error).message).not.toContain(KEY)
  })

  it('keeps the key out of every error message', async () => {
    for (const status of [401, 429, 456, 500]) {
      stubFetch(() => jsonResponse({ message: 'upstream detail' }, status))
      const error = await createDeeplProvider(KEY)
        .translate(['One'], FR)
        .catch((e: unknown) => e)
      expect(String(error)).not.toContain(KEY)
      expect(String(error)).not.toContain('test-key')
    }
  })
})

describe('hostile provider output', () => {
  /**
   * The provider is not trusted. Even if it returned markup or an injected
   * URL, translated strings re-enter the article through the same renderer and
   * sanitiser as English content, so they are escaped as text and cannot
   * introduce markup, script or a javascript: link.
   */
  it('escapes markup returned in a translated string', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Safe text' }] }],
    }
    const extracted = extractTranslatable(doc)
    const rebuilt = extracted.rebuild([
      '<img src=x onerror="alert(1)"><script>alert(2)</script>',
    ])
    const { html } = renderContent(JSON.stringify(rebuilt))

    // The payload survives as inert text: the angle brackets are escaped, so
    // there is no img element and no script element, only characters.
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toBe(
      '<p>&lt;img src=x onerror="alert(1)"&gt;&lt;script&gt;alert(2)&lt;/script&gt;</p>'
    )
  })

  it('cannot rewrite a link href, because hrefs are never part of the payload', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'the report',
              marks: [{ type: 'link', attrs: { href: 'https://www.ons.gov.uk' } }],
            },
          ],
        },
      ],
    }
    const extracted = extractTranslatable(doc)
    expect(extracted.strings).toEqual(['the report'])

    const { html } = renderContent(
      JSON.stringify(extracted.rebuild(['javascript:alert(1)']))
    )
    expect(html).toContain('href="https://www.ons.gov.uk"')
    expect(html).not.toContain('href="javascript:')
  })

  it('escapes markup returned for a figure caption', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'figure',
          attrs: { src: 'https://example.supabase.co/a.png', alt: 'Chart', caption: 'A caption' },
        },
      ],
    }
    const extracted = extractTranslatable(doc)
    const rebuilt = extracted.rebuild(
      extracted.strings.map(() => '"><script>alert(1)</script>')
    )
    const { html } = renderContent(JSON.stringify(rebuilt))
    expect(html).not.toContain('<script')
    expect(html).toContain('src="https://example.supabase.co/a.png"')
  })
})
