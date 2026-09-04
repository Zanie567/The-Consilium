import {
  buildGlossaryMatcher,
  type GlossaryTermInput,
} from '@/lib/glossary/linkify'

/**
 * Glossary handling for translated articles.
 *
 * The glossary linkifier matches English surface forms, so on a French or
 * Chinese rendering of an article it would match nothing and every definition
 * would silently disappear. Rather than pretend otherwise, the terms that
 * actually occur in a given article are translated alongside its body and
 * stored with it, and the translated article is linkified against those
 * translated surface forms using the existing matcher. There is one linkifier
 * and one tooltip component; only the term list differs.
 *
 * The original English surface forms are retained as aliases on the translated
 * term. Economics writing in French, Spanish and German frequently keeps the
 * English name of a concept, and a term the provider left untranslated in the
 * body would otherwise lose its definition.
 */

/** Word characters for boundary checks, mirroring linkify.ts. */
const WORD_CHAR = /[A-Za-z0-9]/

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

/**
 * Returns the subset of `terms` whose surface forms occur in `texts`, in the
 * order they appear in `terms`.
 *
 * Scoping translation to the terms an article actually uses is what keeps the
 * glossary's cost proportional to the article rather than to the size of the
 * glossary, and what stops an edit to an unrelated term invalidating this
 * article's stored translation.
 */
export function matchedGlossaryTerms(
  terms: readonly GlossaryTermInput[],
  texts: readonly string[]
): GlossaryTermInput[] {
  const matcher = buildGlossaryMatcher([...terms])
  if (!matcher) return []

  const matched = new Set<number>()
  for (const text of texts) {
    if (matched.size === matcher.terms.length) break
    matcher.regex.lastIndex = 0
    for (let m = matcher.regex.exec(text); m; m = matcher.regex.exec(text)) {
      const start = m.index
      const end = start + m[0].length
      if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue
      const surface = m[0].replace(/[\s ]+/g, ' ').toLowerCase()
      const index = matcher.formIndex.get(surface)
      if (index !== undefined) matched.add(index)
    }
  }

  return matcher.terms.filter((_, i) => matched.has(i))
}

/**
 * The two strings translated per glossary term. Aliases are not translated:
 * they are informal English shorthands ("QE", "the Fed") whose translations
 * would be guesses, and they are preserved verbatim as aliases instead.
 */
export function glossaryTranslationStrings(terms: readonly GlossaryTermInput[]): string[] {
  return terms.flatMap((t) => [t.term, t.definition])
}

/**
 * Rebuilds the term list from the provider output produced for
 * `glossaryTranslationStrings(terms)`.
 *
 * `learnMoreUrl` is copied across untouched; it is a URL and is never sent to
 * the provider in the first place.
 */
export function applyGlossaryTranslations(
  terms: readonly GlossaryTermInput[],
  translated: readonly string[]
): GlossaryTermInput[] {
  if (translated.length !== terms.length * 2) {
    throw new Error(
      `glossary slot mismatch: expected ${terms.length * 2} strings, received ${translated.length}`
    )
  }
  return terms.map((term, i) => {
    const translatedTerm = translated[i * 2].trim() || term.term
    const englishForms = [term.term, ...term.aliases]
    return {
      id: term.id,
      term: translatedTerm,
      // Deduplicated so a term the provider left unchanged does not list itself
      // twice; the matcher would ignore the repeat, but the stored row stays clean.
      aliases: [...new Set(englishForms.filter((f) => f !== translatedTerm))],
      definition: translated[i * 2 + 1],
      learnMoreUrl: term.learnMoreUrl ?? null,
    }
  })
}

/** Narrows unknown JSON read back from the database to a term list. */
export function parseStoredGlossaryTerms(value: unknown): GlossaryTermInput[] {
  if (!Array.isArray(value)) return []
  const terms: GlossaryTermInput[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.term !== 'string' ||
      typeof record.definition !== 'string'
    ) {
      continue
    }
    terms.push({
      id: record.id,
      term: record.term,
      aliases: Array.isArray(record.aliases)
        ? record.aliases.filter((a): a is string => typeof a === 'string')
        : [],
      definition: record.definition,
      learnMoreUrl: typeof record.learnMoreUrl === 'string' ? record.learnMoreUrl : null,
    })
  }
  return terms
}
