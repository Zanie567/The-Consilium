import { createHash } from 'node:crypto'

/**
 * Bumped whenever the set of strings the extractor collects changes shape.
 * Folding it into every hash means an extractor change invalidates existing
 * rows instead of leaving them keyed against a payload that is no longer the
 * one being produced.
 */
export const TRANSLATION_PAYLOAD_VERSION = 1

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256')
  hash.update(String(TRANSLATION_PAYLOAD_VERSION))
  for (const part of parts) {
    // Length-prefixed so ["ab","c"] and ["a","bc"] cannot collide.
    hash.update(' ')
    hash.update(String(part.length))
    hash.update(' ')
    hash.update(part)
  }
  return hash.digest('hex')
}

/**
 * Fingerprints exactly the text that would be sent to the provider.
 *
 * Deliberately NOT derived from `updatedAt`: re-tagging an article, featuring
 * it, editing an editor-only note or recomputing its engagement score all bump
 * `updatedAt` without changing a single translatable string, and none of those
 * should trigger a paid retranslation. Conversely, any edit that does change
 * the title, excerpt or body text changes this hash, so a stored translation of
 * the previous version can never be mistaken for a translation of the current
 * one.
 */
export function sourceContentHash(input: {
  title: string
  excerpt: string | null
  strings: readonly string[]
}): string {
  return digest([input.title, input.excerpt ?? '', ...input.strings])
}

/**
 * Fingerprints the glossary terms that actually appear in this article.
 *
 * Scoped to matched terms so that editing an unrelated glossary entry does not
 * invalidate every article's stored translation.
 */
export function glossaryPayloadHash(
  terms: readonly { id: string; term: string; definition: string; learnMoreUrl?: string | null }[]
): string {
  if (terms.length === 0) return 'none'
  return digest(
    terms.map((t) => `${t.id}${t.term}${t.definition}${t.learnMoreUrl ?? ''}`).sort()
  )
}
