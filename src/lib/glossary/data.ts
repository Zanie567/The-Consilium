import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { GLOSSARY_ENABLED_KEY } from '@/lib/constants'
import {
  buildGlossaryMatcher,
  linkifyGlossaryTerms,
  type GlossaryMatcher,
  type GlossaryTermInput,
} from './linkify'

/**
 * Cached glossary plumbing for the public article page.
 *
 * Three layers, cheapest first:
 *
 *   1. The terms + on/off switch live in one unstable_cache entry tagged
 *      'glossary'. Every admin mutation calls revalidateTag('glossary'), so
 *      toggling the switch or editing a term takes effect on the next request
 *      without redeploying; the 5 minute revalidate is a safety net for any
 *      writer that forgets the tag.
 *   2. The matcher (sorted surface forms + compiled regex) is rebuilt only
 *      when the term set changes, detected via a fingerprint of ids and
 *      updatedAt timestamps.
 *   3. The linkified HTML per article is memoised in an in-process LRU keyed
 *      by article id + article updatedAt + glossary fingerprint, so a popular
 *      article page does not re-parse its HTML on every request. The key
 *      self-invalidates when either the article or the glossary changes. The
 *      map is per server instance (serverless cold starts begin empty), which
 *      is fine: it is purely a performance shortcut, never a source of truth.
 */

export interface GlossarySnapshot {
  enabled: boolean
  terms: GlossaryTermInput[]
  /** Changes whenever the set of active terms changes in any way. */
  fingerprint: string
}

const EMPTY_SNAPSHOT: GlossarySnapshot = { enabled: false, terms: [], fingerprint: 'empty' }

/** Cache tag invalidated by every glossary admin mutation. */
export const GLOSSARY_CACHE_TAG = 'glossary'

const loadGlossarySnapshot = unstable_cache(
  async (): Promise<GlossarySnapshot> => {
    try {
      const [setting, rows] = await Promise.all([
        prisma.siteSetting.findUnique({
          where: { key: GLOSSARY_ENABLED_KEY },
          select: { value: true },
        }),
        prisma.glossaryTerm.findMany({
          where: { isActive: true },
          orderBy: { term: 'asc' },
          select: {
            id: true,
            term: true,
            aliases: true,
            definition: true,
            learnMoreUrl: true,
            updatedAt: true,
          },
        }),
      ])
      const enabled = setting?.value === 'true'
      const terms: GlossaryTermInput[] = rows.map((r) => ({
        id: r.id,
        term: r.term,
        aliases: r.aliases,
        definition: r.definition,
        learnMoreUrl: r.learnMoreUrl,
      }))
      const fingerprint =
        rows.length === 0
          ? 'empty'
          : rows.map((r) => `${r.id}:${r.updatedAt.getTime()}`).join('|')
      return { enabled, terms, fingerprint }
    } catch (err) {
      // Most likely the glossary_terms table has not been created yet. Degrade
      // to "feature off" so article pages always render.
      console.error(
        '[glossary] failed to load terms:',
        err instanceof Error ? err.message : String(err)
      )
      return EMPTY_SNAPSHOT
    }
  },
  ['glossary-snapshot'],
  { tags: [GLOSSARY_CACHE_TAG], revalidate: 300 }
)

// Matcher memo: one entry, rebuilt when the fingerprint changes.
let matcherFingerprint: string | null = null
let matcherInstance: GlossaryMatcher | null = null

function matcherFor(snapshot: GlossarySnapshot): GlossaryMatcher | null {
  if (matcherFingerprint !== snapshot.fingerprint) {
    matcherInstance = buildGlossaryMatcher(snapshot.terms)
    matcherFingerprint = snapshot.fingerprint
  }
  return matcherInstance
}

// Per-article linkified HTML, bounded LRU (Map preserves insertion order).
const LINKIFIED_CACHE_MAX = 300
const linkifiedCache = new Map<string, string>()

function cacheGet(key: string): string | undefined {
  const hit = linkifiedCache.get(key)
  if (hit !== undefined) {
    // Refresh recency.
    linkifiedCache.delete(key)
    linkifiedCache.set(key, hit)
  }
  return hit
}

function cacheSet(key: string, value: string) {
  linkifiedCache.set(key, value)
  if (linkifiedCache.size > LINKIFIED_CACHE_MAX) {
    const oldest = linkifiedCache.keys().next().value
    if (oldest !== undefined) linkifiedCache.delete(oldest)
  }
}

export interface GlossaryResult {
  html: string
  /** True when at least one term was linked (controls tooltip JS mounting). */
  hasLinks: boolean
}

/**
 * Applies glossary term linking to a sanitized article body. Returns the
 * input HTML untouched when the feature is off, the glossary is empty, or
 * nothing matches.
 */
export async function applyGlossaryLinks(
  articleId: string,
  articleUpdatedAt: Date,
  sanitizedHtml: string
): Promise<GlossaryResult> {
  const snapshot = await loadGlossarySnapshot()
  if (!snapshot.enabled || snapshot.terms.length === 0) {
    return { html: sanitizedHtml, hasLinks: false }
  }

  const key = `${articleId}:${articleUpdatedAt.getTime()}:${snapshot.fingerprint}`
  const cached = cacheGet(key)
  if (cached !== undefined) {
    return { html: cached, hasLinks: cached !== sanitizedHtml }
  }

  const linkified = linkifyGlossaryTerms(sanitizedHtml, matcherFor(snapshot))
  cacheSet(key, linkified)
  return { html: linkified, hasLinks: linkified !== sanitizedHtml }
}
