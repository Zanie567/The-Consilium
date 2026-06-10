import { Parser } from 'htmlparser2'
import { escapeHtml } from '@/lib/escapeHtml'

/**
 * Glossary term linkifier.
 *
 * Wraps the first occurrence of each active glossary term in an article body
 * with a tooltip trigger:
 *
 *   <span class="glossary-term" data-gloss-term="…" data-gloss-def="…"
 *         [data-gloss-url="…"]>matched text</span>
 *
 * Design constraints, all load-bearing:
 *
 *   * Input is the OUTPUT of sanitizeArticleHtml (well-formed, allowlisted
 *     HTML whose only character entities are &amp; &lt; &gt; &quot;). The
 *     linkifier never runs on raw editor HTML.
 *   * The document is tokenized with htmlparser2 (the same parser sanitize-html
 *     uses) and matching happens ONLY inside text nodes, located by byte range
 *     in the original string. Replacements are spliced into the original, so
 *     everything outside a wrapped term is byte-identical to the input, and an
 *     article with no matches returns the input string unchanged.
 *   * Text inside <a>, headings, <code>/<pre>, <blockquote>, <aside>
 *     (pull quotes), <figure>/<figcaption> (image captions and credits) and
 *     <sup> (footnote refs) is never matched.
 *   * Matching is case-insensitive on word boundaries, longest surface form
 *     first. Beyond exact terms and aliases, two conservative inflections are
 *     matched: regular plurals generated with standard rules (+s, +es after
 *     sibilants, consonant-y to -ies; skipped for forms ending in capitals or
 *     digits, so acronyms never inflect), and possessives, which need no extra
 *     rule because the apostrophe is a word boundary ("the Fed's" links
 *     "the Fed"). Irregular plurals are not attempted.
 *   * Only the first occurrence of each term (across all its surface forms)
 *     is linked per article.
 *   * Definitions and URLs are escaped with escapeHtml before being placed in
 *     attributes; URLs must be http(s). The matched article text itself is
 *     reused verbatim from the sanitized input.
 */

export interface GlossaryTermInput {
  id: string
  term: string
  aliases: string[]
  definition: string
  learnMoreUrl?: string | null
}

interface SurfaceForm {
  /** Lowercased surface text this form matches, e.g. "phillips curves". */
  surface: string
  /** Index into the matcher's terms array. */
  termIndex: number
}

export interface GlossaryMatcher {
  terms: GlossaryTermInput[]
  forms: SurfaceForm[]
  /** Single alternation regex over all surface forms, longest first. */
  regex: RegExp
  /** Lowercased surface -> termIndex for resolving which term matched. */
  formIndex: Map<string, number>
}

/** Tags whose entire subtree is excluded from matching. */
const SKIP_TAGS = new Set([
  'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'code', 'pre',
  'blockquote',
  'aside',
  'figure', 'figcaption',
  'sup',
  'script', 'style', 'textarea',
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Generates the plural surface form for a term, or null when pluralising
 * would be unsafe. The check runs on the term AS WRITTEN (before
 * lowercasing): anything not ending in a lowercase letter (acronyms like
 * "GDP", digits like "M2") never inflects. Standard regular rules only;
 * irregular nouns are not attempted.
 */
function pluralOf(asWritten: string): string | null {
  const last = asWritten[asWritten.length - 1]
  if (!last || !/[a-z]/.test(last)) return null
  const surface = asWritten.toLowerCase()
  if (/(?:s|x|z|ch|sh)$/.test(surface)) return `${surface}es`
  if (/[^aeiou]y$/.test(surface)) return `${surface.slice(0, -1)}ies`
  return `${surface}s`
}

/**
 * Builds the matcher once for a given set of active terms. Returns null when
 * there is nothing to match, which callers treat as "leave the HTML alone".
 */
export function buildGlossaryMatcher(terms: GlossaryTermInput[]): GlossaryMatcher | null {
  const forms: SurfaceForm[] = []
  const formIndex = new Map<string, number>()

  const addForm = (raw: string, termIndex: number) => {
    const surface = raw.trim().replace(/\s+/g, ' ').toLowerCase()
    // Surface forms must contain at least one letter or digit; anything else
    // cannot be matched on word boundaries.
    if (!surface || !/[a-z0-9]/.test(surface)) return
    // First definition wins on collisions (e.g. the same alias on two terms).
    if (formIndex.has(surface)) return
    formIndex.set(surface, termIndex)
    forms.push({ surface, termIndex })
  }

  terms.forEach((term, termIndex) => {
    for (const raw of [term.term, ...term.aliases]) {
      const asWritten = raw.trim().replace(/\s+/g, ' ')
      addForm(asWritten, termIndex)
      const plural = pluralOf(asWritten)
      if (plural) addForm(plural, termIndex)
    }
  })

  if (forms.length === 0) return null

  // Longest first so that at any given position the regex alternation prefers
  // "phillips curve" over "phillips", and "externalities" over "externality".
  forms.sort((a, b) => b.surface.length - a.surface.length || (a.surface < b.surface ? -1 : 1))

  const alternation = forms
    // Internal spaces match any whitespace run (including non-breaking spaces)
    // so a term split across a line break in the source still matches.
    .map((f) => escapeRegExp(f.surface).replace(/ /g, '[\\s\\u00a0]+'))
    .join('|')
  const regex = new RegExp(alternation, 'gi')

  return { terms, forms, regex, formIndex }
}

/** Character entity spans (&amp; &#39; &#x27; …) found in a raw text node. */
const ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#[xX][0-9a-fA-F]+);/g

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch)
}

interface TextRange {
  start: number
  /** Exclusive. */
  end: number
}

interface Replacement {
  start: number
  end: number
  html: string
}

function safeLearnMoreUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url
  } catch {}
  return null
}

function wrapMatch(matchedText: string, term: GlossaryTermInput): string {
  const url = safeLearnMoreUrl(term.learnMoreUrl)
  const urlAttr = url ? ` data-gloss-url="${escapeHtml(url)}"` : ''
  return (
    `<span class="glossary-term" data-gloss-term="${escapeHtml(term.term)}"` +
    ` data-gloss-def="${escapeHtml(term.definition)}"${urlAttr}>` +
    `${matchedText}</span>`
  )
}

/**
 * Collects the [start, end) ranges of text nodes that sit outside every
 * skipped tag. Ranges are merged when htmlparser2 splits one logical text node
 * into several events.
 */
function collectLinkableTextRanges(html: string): TextRange[] {
  const ranges: TextRange[] = []
  let skipDepth = 0
  let open: TextRange | null = null

  const flush = () => {
    if (open) {
      ranges.push(open)
      open = null
    }
  }

  const parser = new Parser(
    {
      onopentag(name) {
        flush()
        if (SKIP_TAGS.has(name)) skipDepth++
      },
      onclosetag(name) {
        flush()
        if (SKIP_TAGS.has(name) && skipDepth > 0) skipDepth--
      },
      ontext() {
        if (skipDepth > 0) return
        const start = parser.startIndex
        const end = parser.endIndex + 1
        if (open && open.end === start) {
          open.end = end
        } else {
          flush()
          open = { start, end }
        }
      },
      oncomment() {
        flush()
      },
      onend() {
        flush()
      },
    },
    // Raw offsets into the original string are what matter; entity decoding is
    // irrelevant because matching re-reads the raw slice.
    { decodeEntities: false, lowerCaseTags: true }
  )
  parser.write(html)
  parser.end()
  return ranges
}

/**
 * Wraps the first occurrence of each glossary term in `html` with the tooltip
 * trigger markup. Returns the input string itself (same reference, byte
 * identical) when the matcher is null or nothing matches.
 */
export function linkifyGlossaryTerms(html: string, matcher: GlossaryMatcher | null): string {
  if (!matcher || html === '') return html

  const replacements: Replacement[] = []
  const linkedTermIndexes = new Set<number>()

  for (const range of collectLinkableTextRanges(html)) {
    if (linkedTermIndexes.size === matcher.terms.length) break

    const raw = html.slice(range.start, range.end)

    // Entity spans within this text node. A match may fully contain an entity
    // (e.g. a non-breaking space between two words) but must never start or
    // end inside one, so "amp" never matches inside "&amp;".
    const entitySpans: Array<[number, number]> = []
    ENTITY_RE.lastIndex = 0
    for (let e = ENTITY_RE.exec(raw); e; e = ENTITY_RE.exec(raw)) {
      entitySpans.push([e.index, e.index + e[0].length])
    }
    const insideEntity = (pos: number) =>
      entitySpans.some(([s, e]) => pos > s && pos < e)

    matcher.regex.lastIndex = 0
    for (let m = matcher.regex.exec(raw); m; m = matcher.regex.exec(raw)) {
      const matchStart = m.index
      const matchEnd = m.index + m[0].length

      // Word boundaries: the characters immediately before and after the
      // match must not be letters or digits. This is what stops "extern"
      // matching inside "external" and what makes possessives work (the
      // apostrophe after "the Fed" is a boundary).
      if (isWordChar(raw[matchStart - 1]) || isWordChar(raw[matchEnd])) continue
      // Never start or end a match inside a character entity.
      if (insideEntity(matchStart) || insideEntity(matchEnd)) continue

      const surface = m[0].replace(/[\s ]+/g, ' ').toLowerCase()
      const termIndex = matcher.formIndex.get(surface)
      if (termIndex === undefined) continue
      if (linkedTermIndexes.has(termIndex)) continue

      linkedTermIndexes.add(termIndex)
      replacements.push({
        start: range.start + matchStart,
        end: range.start + matchEnd,
        html: wrapMatch(m[0], matcher.terms[termIndex]),
      })
    }
  }

  if (replacements.length === 0) return html

  // Replacements are collected in document order and never overlap; splice
  // them back to front so earlier offsets stay valid.
  let result = html
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    result = result.slice(0, r.start) + r.html + result.slice(r.end)
  }
  return result
}
