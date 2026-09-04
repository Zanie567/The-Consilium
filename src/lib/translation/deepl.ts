import type { TargetLocale } from './locales'
import {
  TranslationProviderError,
  type TranslationProvider,
} from './provider'

/**
 * DeepL API v2 client.
 *
 * Only plain text is ever sent: the caller extracts leaf strings from the
 * article's TipTap document, so `tag_handling` is deliberately NOT set and no
 * markup crosses the provider boundary in either direction.
 *
 * References (verified against the live documentation, not recalled):
 *   * POST /v2/translate, `Authorization: DeepL-Auth-Key <key>`, request
 *     parameters and response shape:
 *     https://developers.deepl.com/docs/api-reference/translate
 *   * Language codes, including ZH-HANS for Simplified Chinese:
 *     https://developers.deepl.com/docs/getting-started/supported-languages
 *   * Free keys carry the ":fx" suffix and must call api-free.deepl.com;
 *     everything else calls api.deepl.com:
 *     https://developers.deepl.com/docs/getting-started/auth
 *   * Up to 50 texts and 128 KiB per request:
 *     https://developers.deepl.com/api-reference/translate/request-translation
 */

const FREE_KEY_SUFFIX = ':fx'
const FREE_API_BASE = 'https://api-free.deepl.com'
const PRO_API_BASE = 'https://api.deepl.com'

/** DeepL's documented per-request ceilings. */
export const DEEPL_MAX_TEXTS_PER_REQUEST = 50
/** 128 KiB, less headroom for the non-text form fields. */
const DEEPL_MAX_REQUEST_BYTES = 120 * 1024

const REQUEST_TIMEOUT_MS = 30_000

/**
 * Register hint sent with every request. DeepL treats `context` as guidance
 * only: it influences word choice but is never itself translated or returned,
 * and it is not billed as translated characters. It is what nudges the model
 * towards the economics/policy register rather than generic prose.
 */
const TRANSLATION_CONTEXT =
  'An article from The Consilium, a university economics and public policy publication. ' +
  'Use formal journalistic register and standard economics terminology.'

/**
 * Chooses the API host for a key.
 *
 * DeepL documents that keys ending ":fx" belong to a free-tier account and must
 * call api-free.deepl.com, while every other key calls api.deepl.com. That rule
 * predates the Developer plan, so DEEPL_API_HOST exists as an explicit override
 * for an account whose key does not follow it; scripts/verify-deepl.mjs probes
 * both hosts and reports which one the key actually authenticates against.
 */
export function deeplApiBase(authKey: string, hostOverride?: string): string {
  const override = (hostOverride ?? process.env.DEEPL_API_HOST)?.trim()
  if (override) return override.replace(/\/$/, '')
  return authKey.trimEnd().endsWith(FREE_KEY_SUFFIX) ? FREE_API_BASE : PRO_API_BASE
}

interface DeeplTranslationEntry {
  text?: unknown
}

interface DeeplResponseBody {
  translations?: unknown
  message?: unknown
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Splits `texts` into requests that respect both DeepL ceilings. A single
 * string larger than the byte budget still goes out alone: DeepL accepts it up
 * to its own limit, and rejecting it here would silently drop article text.
 */
export function batchTexts(texts: readonly string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let currentBytes = 0

  for (const text of texts) {
    const bytes = byteLength(text)
    const wouldExceed =
      current.length >= DEEPL_MAX_TEXTS_PER_REQUEST ||
      (current.length > 0 && currentBytes + bytes > DEEPL_MAX_REQUEST_BYTES)
    if (wouldExceed) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(text)
    currentBytes += bytes
  }

  if (current.length > 0) batches.push(current)
  return batches
}

function classifyStatus(status: number): TranslationProviderError['kind'] {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limited'
  // 456 is DeepL's dedicated "character quota exceeded" status.
  if (status === 456) return 'quota'
  if (status === 400) return 'unsupported_language'
  return 'provider_error'
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as DeeplResponseBody
    if (typeof body.message === 'string') return body.message
  } catch {}
  return response.statusText || `HTTP ${response.status}`
}

async function translateBatch(
  texts: readonly string[],
  locale: TargetLocale,
  authKey: string
): Promise<string[]> {
  const body = new URLSearchParams()
  for (const text of texts) body.append('text', text)
  body.set('source_lang', 'EN')
  body.set('target_lang', locale.deeplTarget)
  body.set('context', TRANSLATION_CONTEXT)
  // Keeps leading/trailing whitespace and punctuation of each string intact,
  // which matters because these strings are spliced back into a document
  // whose spacing was decided by the editor.
  body.set('preserve_formatting', '1')
  // `prefer_more` rather than `more`: the prefixed form is ignored for target
  // languages that have no formality distinction (Simplified Chinese) instead
  // of failing the whole request with a 400.
  body.set('formality', 'prefer_more')
  body.set('model_type', 'prefer_quality_optimized')

  let response: Response
  try {
    response = await fetch(`${deeplApiBase(authKey)}/v2/translate`, {
      method: 'POST',
      headers: {
        // The key travels only in this header, only from the server.
        Authorization: `DeepL-Auth-Key ${authKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (error) {
    throw new TranslationProviderError(
      'network',
      `DeepL request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!response.ok) {
    // The message comes from DeepL and never contains the key, but it is only
    // ever logged server-side by the caller, never returned to a browser.
    throw new TranslationProviderError(
      classifyStatus(response.status),
      `DeepL responded ${response.status}: ${await readErrorMessage(response)}`,
      response.status
    )
  }

  let parsed: DeeplResponseBody
  try {
    parsed = (await response.json()) as DeeplResponseBody
  } catch {
    throw new TranslationProviderError('malformed_response', 'DeepL returned a non-JSON body')
  }

  const entries = parsed.translations
  if (!Array.isArray(entries) || entries.length !== texts.length) {
    throw new TranslationProviderError(
      'malformed_response',
      `DeepL returned ${Array.isArray(entries) ? entries.length : 'no'} translations for ${texts.length} inputs`
    )
  }

  return entries.map((entry: DeeplTranslationEntry, index) => {
    if (typeof entry?.text !== 'string') {
      throw new TranslationProviderError(
        'malformed_response',
        `DeepL translation ${index} has no text field`
      )
    }
    return entry.text
  })
}

export function createDeeplProvider(authKey: string): TranslationProvider {
  return {
    name: 'deepl',
    async translate(texts, locale) {
      if (texts.length === 0) return []
      const results: string[] = []
      // Batches run in sequence: a burst of parallel requests is what trips
      // DeepL's rate limiter, and an article is a handful of batches at most.
      for (const batch of batchTexts(texts)) {
        results.push(...(await translateBatch(batch, locale, authKey)))
      }
      return results
    },
  }
}

/**
 * Builds the provider from the environment, or returns null when no key is
 * configured. A null provider is a supported state, not an error: the language
 * selector is hidden and every article renders as English, so an unconfigured
 * deployment shows no broken UI.
 *
 * DEEPL_API_KEY is server-only. It is deliberately not prefixed NEXT_PUBLIC_,
 * and this module is imported only from server components and server-side
 * services, so the key can never reach the client bundle.
 */
export function getConfiguredProvider(): TranslationProvider | null {
  const key = process.env.DEEPL_API_KEY?.trim()
  if (!key) return null
  return createDeeplProvider(key)
}

/** True when a provider key is present. Safe to call from server components. */
export function isTranslationConfigured(): boolean {
  return Boolean(process.env.DEEPL_API_KEY?.trim())
}
