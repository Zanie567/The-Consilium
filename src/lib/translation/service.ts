import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import type { GlossaryTermInput } from '@/lib/glossary/linkify'
import { getGlossarySnapshot } from '@/lib/glossary/data'
import type { TargetLocale } from './locales'
import { getConfiguredProvider } from './deepl'
import { TranslationProviderError, type TranslationProvider } from './provider'
import { extractTranslatable, parseArticleDocument } from './tiptapText'
import { glossaryPayloadHash, sourceContentHash } from './hash'
import {
  applyGlossaryTranslations,
  glossaryTranslationStrings,
  matchedGlossaryTerms,
  parseStoredGlossaryTerms,
} from './glossaryTerms'

/**
 * Article translation: read-through cache over the translation provider.
 *
 *   English article (canonical, never modified)
 *     -> translatable strings extracted from its TipTap document
 *     -> content hash
 *     -> stored translation for (articleId, locale) if its hash still matches
 *     -> otherwise one provider call, stored, then served from storage forever
 *
 * Cost properties that follow from this shape:
 *
 *   * A reader never triggers a provider call for a translation that already
 *     exists at the current content hash, so an article is paid for at most
 *     once per language per edit.
 *   * The locale allowlist bounds the total number of translations the site can
 *     ever generate at (articles x 4). An attacker cannot invent locales.
 *   * Concurrent first requests for the same article and locale share a single
 *     in-flight promise per server instance, so a simultaneous burst does not
 *     become a burst of paid calls. Cross-instance duplication is possible and
 *     accepted: the unique constraint makes the write safe, and the wasted call
 *     is bounded by the number of instances, which is not worth a distributed
 *     lock on a site this size.
 */

export type TranslationUnavailableReason =
  | 'not_configured'
  | 'rate_limited'
  | 'provider_error'

export interface ArticleTranslationContent {
  title: string
  excerpt: string | null
  /** Translated TipTap JSON, rendered by the same renderer as the English article. */
  content: string
  /** Glossary terms for this article, with translated surface forms and definitions. */
  glossaryTerms: GlossaryTermInput[]
  /**
   * The hashes this translation was generated from. Exposed so the render layer
   * can key its own caches on the exact inputs, rather than on a proxy such as
   * the article's updatedAt, which changes on edits that do not affect the
   * translation and misses glossary edits that do.
   */
  sourceHash: string
  glossaryHash: string
}

export type ArticleTranslationResult =
  | { status: 'translated'; translation: ArticleTranslationContent }
  | { status: 'unavailable'; reason: TranslationUnavailableReason }

export interface TranslateArticleInput {
  articleId: string
  title: string
  excerpt: string | null
  /** Stored article content: TipTap JSON, or plain text for legacy rows. */
  content: string
  locale: TargetLocale
  /**
   * Caller identity (an IP) used to rate-limit the generation of NEW
   * translations. Serving an existing translation is never rate-limited.
   */
  clientKey?: string
}

/**
 * New translations one client may cause per window. Generation is already
 * bounded overall by the locale allowlist and the cache; this only blunts a
 * single client walking the archive to force every article into every language
 * at once.
 */
const GENERATION_RATE_LIMIT = 8
const GENERATION_RATE_WINDOW_MS = 60 * 60 * 1000

/** Per-instance de-duplication of concurrent first requests. */
const inFlight = new Map<string, Promise<ArticleTranslationResult>>()

/**
 * Adapter over the two stored content shapes. Articles are TipTap JSON; a few
 * legacy rows are plain text, which the renderer escapes and prints as-is.
 */
interface ContentPayload {
  strings: string[]
  rebuild(translated: readonly string[]): string
}

function contentPayload(content: string): ContentPayload {
  const doc = parseArticleDocument(content)
  if (doc) {
    const extracted = extractTranslatable(doc)
    return {
      strings: extracted.strings,
      rebuild: (translated) => JSON.stringify(extracted.rebuild(translated)),
    }
  }
  // Plain-text fallback: the whole body is one string.
  const trimmed = content.trim()
  if (trimmed === '') return { strings: [], rebuild: () => content }
  return {
    strings: [content],
    rebuild: (translated) => translated[0] ?? content,
  }
}

function logProviderFailure(locale: TargetLocale, articleId: string, error: unknown): void {
  // Only the failure kind and message are logged. TranslationProviderError
  // messages are built from DeepL's status and message fields and never carry
  // the API key or request body.
  const detail =
    error instanceof TranslationProviderError
      ? `${error.kind}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error)
  console.error('[translation] provider failure', {
    articleId,
    locale: locale.code,
    detail,
  })
}

interface StoredRow {
  title: string
  excerpt: string | null
  content: string
  sourceHash: string
  glossaryHash: string
  glossaryTerms: unknown
}

function toContent(row: StoredRow): ArticleTranslationContent {
  return {
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    glossaryTerms: parseStoredGlossaryTerms(row.glossaryTerms),
    sourceHash: row.sourceHash,
    glossaryHash: row.glossaryHash,
  }
}

async function readStoredTranslation(
  articleId: string,
  locale: string
): Promise<StoredRow | null> {
  try {
    return await prisma.articleTranslation.findUnique({
      where: { articleId_locale: { articleId, locale } },
      select: {
        title: true,
        excerpt: true,
        content: true,
        sourceHash: true,
        glossaryHash: true,
        glossaryTerms: true,
      },
    })
  } catch (error) {
    // Most likely the article_translations table does not exist yet. Degrade to
    // "no translation available" so article pages always render.
    console.error(
      '[translation] failed to read stored translation:',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

/**
 * Returns the translation of an article into `locale`, generating it on first
 * request and reusing it thereafter.
 *
 * Never throws: every failure path resolves to `unavailable`, which the article
 * page renders as the untouched English article plus a short notice.
 */
export async function getArticleTranslation(
  input: TranslateArticleInput
): Promise<ArticleTranslationResult> {
  const key = `${input.articleId}:${input.locale.code}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const work = translateArticle(input).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, work)
  return work
}

async function translateArticle(
  input: TranslateArticleInput
): Promise<ArticleTranslationResult> {
  const { articleId, locale } = input

  const provider = getConfiguredProvider()
  if (!provider) return { status: 'unavailable', reason: 'not_configured' }

  const payload = contentPayload(input.content)
  const sourceHash = sourceContentHash({
    title: input.title,
    excerpt: input.excerpt,
    strings: payload.strings,
  })

  // Glossary terms that occur in this article, matched against the English
  // source. An empty list is normal: the feature may be off, or the article may
  // use no glossary term.
  const snapshot = await getGlossarySnapshot()
  const sourceTerms =
    snapshot.enabled && snapshot.terms.length > 0
      ? matchedGlossaryTerms(snapshot.terms, [input.title, input.excerpt ?? '', ...payload.strings])
      : []
  const glossaryHash = glossaryPayloadHash(sourceTerms)

  const stored = await readStoredTranslation(articleId, locale.code)

  const contentCurrent = stored?.sourceHash === sourceHash
  const glossaryCurrent = stored?.glossaryHash === glossaryHash
  if (stored && contentCurrent && glossaryCurrent) {
    return { status: 'translated', translation: toContent(stored) }
  }

  if (input.clientKey) {
    const allowed = checkRateLimit(
      `translate:${input.clientKey}`,
      GENERATION_RATE_LIMIT,
      GENERATION_RATE_WINDOW_MS
    )
    if (!allowed) {
      // A valid translation of the CURRENT content is still safe to serve; only
      // its glossary annotations are behind. A translation of superseded
      // content is not, and is withheld.
      if (stored && contentCurrent) {
        return { status: 'translated', translation: toContent(stored) }
      }
      return { status: 'unavailable', reason: 'rate_limited' }
    }
  }

  try {
    // Only the glossary changed: refresh the term list and keep the paid body
    // translation already on the row.
    if (stored && contentCurrent) {
      const glossaryTerms = await translateGlossary(provider, sourceTerms, locale)
      const row = await writeTranslation({
        articleId,
        locale: locale.code,
        provider: provider.name,
        title: stored.title,
        excerpt: stored.excerpt,
        content: stored.content,
        sourceHash,
        glossaryHash,
        glossaryTerms,
      })
      return { status: 'translated', translation: row }
    }

    const articleStrings = [input.title, input.excerpt ?? '', ...payload.strings]
    const glossaryStrings = glossaryTranslationStrings(sourceTerms)
    // One ordered payload, so batching spans the article and its glossary
    // rather than issuing a separate undersized request for the terms.
    const translated = await provider.translate([...articleStrings, ...glossaryStrings], locale)
    if (translated.length !== articleStrings.length + glossaryStrings.length) {
      throw new TranslationProviderError(
        'malformed_response',
        `provider returned ${translated.length} strings for ${articleStrings.length + glossaryStrings.length} inputs`
      )
    }

    const [translatedTitle, translatedExcerpt, ...rest] = translated
    const bodyStrings = rest.slice(0, payload.strings.length)
    const glossaryTerms = applyGlossaryTranslations(
      sourceTerms,
      rest.slice(payload.strings.length)
    )

    const row = await writeTranslation({
      articleId,
      locale: locale.code,
      provider: provider.name,
      title: translatedTitle,
      excerpt: input.excerpt === null ? null : translatedExcerpt,
      content: payload.rebuild(bodyStrings),
      sourceHash,
      glossaryHash,
      glossaryTerms,
    })
    return { status: 'translated', translation: row }
  } catch (error) {
    logProviderFailure(locale, articleId, error)
    // A cached translation of the CURRENT content survives a provider outage.
    // One of superseded content does not: serving it would present an old
    // article as a translation of the new one.
    if (stored && contentCurrent) {
      return { status: 'translated', translation: toContent(stored) }
    }
    return { status: 'unavailable', reason: 'provider_error' }
  }
}

async function translateGlossary(
  provider: TranslationProvider,
  terms: readonly GlossaryTermInput[],
  locale: TargetLocale
): Promise<GlossaryTermInput[]> {
  if (terms.length === 0) return []
  const translated = await provider.translate(glossaryTranslationStrings(terms), locale)
  return applyGlossaryTranslations(terms, translated)
}

interface WriteInput {
  articleId: string
  locale: string
  provider: string
  title: string
  excerpt: string | null
  content: string
  sourceHash: string
  glossaryHash: string
  glossaryTerms: GlossaryTermInput[]
}

/**
 * Upserts the single row per (article, locale). One row rather than one per
 * version keeps storage bounded and makes "is this translation current?" a
 * hash comparison rather than a history search.
 *
 * A write failure is not fatal: the freshly translated content is returned
 * anyway, so the reader sees the article they asked for even if the cache could
 * not be populated.
 */
async function writeTranslation(input: WriteInput): Promise<ArticleTranslationContent> {
  const content: ArticleTranslationContent = {
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    glossaryTerms: input.glossaryTerms,
    sourceHash: input.sourceHash,
    glossaryHash: input.glossaryHash,
  }

  const data = {
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    sourceHash: input.sourceHash,
    glossaryHash: input.glossaryHash,
    glossaryTerms: input.glossaryTerms as unknown as object,
    provider: input.provider,
  }

  try {
    await prisma.articleTranslation.upsert({
      where: { articleId_locale: { articleId: input.articleId, locale: input.locale } },
      create: { articleId: input.articleId, locale: input.locale, ...data },
      update: data,
    })
  } catch (error) {
    console.error(
      '[translation] failed to store translation:',
      error instanceof Error ? error.message : String(error)
    )
  }

  return content
}
