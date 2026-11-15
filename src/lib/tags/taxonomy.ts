/**
 * Browser-safe tag taxonomy rules: matching what an editor types against the approved tags and their
 * aliases, and spotting tags that probably mean the same thing. Pure functions, unit-tested, used by the
 * editor's tag selector, the management dashboard and the cleanup report.
 *
 * Identity (what makes two wordings "the same tag") is canonicalTagSlug, the JavaScript twin of the
 * database's consilium_tag_identity(); nothing here replaces it. The similarity rules below only ever
 * SUGGEST that two different identities overlap. They never merge anything.
 */
import { canonicalTagSlug } from '@/lib/tagIdentity'

export interface TagOption {
  id: string
  name: string
  slug: string
  aliases: string[]
  /** Articles (any status, not trashed) carrying the tag. */
  articleCount: number
  retired: boolean
}

export interface TagMatch {
  tag: TagOption
  /** The alias that matched, when the tag was found by another name. */
  via?: string
  /** True when the typed text IS this tag (same identity as its name or an alias). */
  exact: boolean
}

/** Lower-case, accents removed, for "contains" matching ("economie" finds "Économie"). */
export function foldTagText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().trim()
}

/**
 * Approved tags that match `query`, best first: an exact name or alias, then names starting with the
 * query, then names or aliases containing it. Retired tags are never offered. With an empty query the
 * most used tags come first, so the list is useful before anything is typed.
 */
export function matchTags(options: readonly TagOption[], query: string, limit = 8): TagMatch[] {
  const active = options.filter((t) => !t.retired)
  const q = foldTagText(query)
  if (!q) {
    return [...active]
      .sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((tag) => ({ tag, exact: false }))
  }
  const identity = canonicalTagSlug(query)
  const scored: { match: TagMatch; score: number }[] = []
  for (const tag of active) {
    const name = foldTagText(tag.name)
    if (identity && canonicalTagSlug(tag.name) === identity) {
      scored.push({ match: { tag, exact: true }, score: 0 })
      continue
    }
    const alias = tag.aliases.find((a) => identity && canonicalTagSlug(a) === identity)
    if (alias) {
      scored.push({ match: { tag, via: alias, exact: true }, score: 1 })
      continue
    }
    if (name.startsWith(q)) scored.push({ match: { tag, exact: false }, score: 2 })
    else if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q))) scored.push({ match: { tag, exact: false }, score: 3 })
    else if (name.includes(q)) scored.push({ match: { tag, exact: false }, score: 4 })
    else {
      const aliasHit = tag.aliases.find((a) => foldTagText(a).includes(q))
      if (aliasHit) scored.push({ match: { tag, via: aliasHit, exact: false }, score: 5 })
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || b.match.tag.articleCount - a.match.tag.articleCount || a.match.tag.name.localeCompare(b.match.tag.name))
    .slice(0, limit)
    .map((s) => s.match)
}

/** The tag a wording names exactly (by its name or an alias), retired ones included. */
export function findExactTag(options: readonly TagOption[], name: string): TagMatch | null {
  const identity = canonicalTagSlug(name)
  if (!identity) return null
  for (const tag of options) {
    if (canonicalTagSlug(tag.name) === identity) return { tag, exact: true }
    const alias = tag.aliases.find((a) => canonicalTagSlug(a) === identity)
    if (alias) return { tag, via: alias, exact: true }
  }
  return null
}

// ── Similarity ──────────────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['and', 'of', 'the', 'in', 'on', 'for', 'to', 'a', 'an', 'uk', 's'])

/** Very small English stemmer: enough to treat "Markets"/"Market" and "Policies"/"Policy" as one. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) return word.slice(0, -1)
  return word
}

function words(name: string): string[] {
  return canonicalTagSlug(name).split('-').filter(Boolean)
}

/** Content words, stemmed, sorted: "Labour Markets" and "the labour market" give the same key. */
export function tagWordKey(name: string): string {
  const content = words(name).filter((w) => !STOP_WORDS.has(w)).map(stem)
  return [...new Set(content.length ? content : words(name).map(stem))].sort().join(' ')
}

function initials(name: string): string {
  return words(name).filter((w) => !STOP_WORDS.has(w)).map((w) => w[0]).join('')
}

/** Edit distance, bounded: stops counting once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j])
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

export type OverlapReason =
  /** Same words once case, punctuation, plurals and filler words are ignored. */
  | 'same-words'
  /** Almost the same spelling: likely a typo or variant spelling. */
  | 'spelling'
  /** One is the initials of the other ("AI", "Artificial Intelligence"). */
  | 'acronym'
  /** One tag's words are all part of the other's ("Monetary Policy", "UK Monetary Policy"). */
  | 'contains'

export const OVERLAP_LABELS: Record<OverlapReason, string> = {
  'same-words': 'Same words',
  spelling: 'Near-identical spelling',
  acronym: 'Abbreviation',
  contains: 'One contains the other',
}

/** Likely duplicates are worth merging after a look; possible overlaps need an editorial judgement. */
export const OVERLAP_STRENGTH: Record<OverlapReason, 'likely' | 'possible'> = {
  'same-words': 'likely',
  spelling: 'likely',
  acronym: 'possible',
  contains: 'possible',
}

/** Why two tag names might mean the same topic, or null. Symmetric. */
export function overlapReason(a: string, b: string): OverlapReason | null {
  const ia = canonicalTagSlug(a)
  const ib = canonicalTagSlug(b)
  if (!ia || !ib || ia === ib) return null
  const ka = tagWordKey(a)
  const kb = tagWordKey(b)
  if (ka && ka === kb) return 'same-words'
  const shorter = Math.min(ia.length, ib.length)
  if (shorter >= 5 && editDistance(ia, ib, 2) <= (shorter >= 9 ? 2 : 1)) return 'spelling'
  const [short, long] = ia.length <= ib.length ? [ia, ib] : [ib, ia]
  if (short.length >= 2 && short.length <= 5 && !short.includes('-') && words(long).length >= 2 && initials(long) === short) return 'acronym'
  // Unstemmed words here: "Economics" must not count as part of "Economic Policy".
  const contentWords = (name: string) => new Set(words(name).filter((w) => !STOP_WORDS.has(w)))
  const wa = contentWords(a)
  const wb = contentWords(b)
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa]
  if (small.size >= 1 && big.size > small.size && [...small].every((w) => big.has(w)) && [...small].join('').length >= 4) return 'contains'
  return null
}

export interface TagOverlap<T> {
  a: T
  b: T
  reason: OverlapReason
  strength: 'likely' | 'possible'
}

/**
 * Pairs of tags that may be duplicates or overlap, likely ones first. Aliases count as the tag's
 * names, so "CPI" (an alias of Inflation) beside a separate "CPI Inflation" tag is reported.
 * Quadratic, which is fine for a taxonomy of hundreds of tags.
 */
export function findTagOverlaps<T extends { id: string; name: string; aliases?: readonly string[] }>(tags: readonly T[]): TagOverlap<T>[] {
  const out: TagOverlap<T>[] = []
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const namesA = [tags[i].name, ...(tags[i].aliases ?? [])]
      const namesB = [tags[j].name, ...(tags[j].aliases ?? [])]
      let reason: OverlapReason | null = null
      for (const x of namesA) {
        for (const y of namesB) {
          const r = overlapReason(x, y)
          if (r && (!reason || OVERLAP_STRENGTH[r] === 'likely')) reason = r
          if (reason && OVERLAP_STRENGTH[reason] === 'likely') break
        }
        if (reason && OVERLAP_STRENGTH[reason] === 'likely') break
      }
      if (reason) out.push({ a: tags[i], b: tags[j], reason, strength: OVERLAP_STRENGTH[reason] })
    }
  }
  return out.sort((x, y) => (x.strength === y.strength ? x.a.name.localeCompare(y.a.name) : x.strength === 'likely' ? -1 : 1))
}

/** Existing tags a new wording would probably duplicate, for the "a suitable tag already exists" hint. */
export function similarTags(options: readonly TagOption[], name: string, limit = 3): { tag: TagOption; reason: OverlapReason }[] {
  const out: { tag: TagOption; reason: OverlapReason; rank: number }[] = []
  for (const tag of options) {
    if (tag.retired) continue
    let best: OverlapReason | null = null
    for (const n of [tag.name, ...tag.aliases]) {
      const r = overlapReason(name, n)
      if (r && (!best || OVERLAP_STRENGTH[r] === 'likely')) best = r
    }
    if (best) out.push({ tag, reason: best, rank: OVERLAP_STRENGTH[best] === 'likely' ? 0 : 1 })
  }
  return out.sort((a, b) => a.rank - b.rank || b.tag.articleCount - a.tag.articleCount).slice(0, limit).map(({ tag, reason }) => ({ tag, reason }))
}
