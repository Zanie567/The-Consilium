/**
 * content-filter.ts - server-side only content moderation.
 *
 * Zero-tolerance for hate speech, slurs, and targeted harassment.
 * Constructive criticism, disagreement, and profanity alone are NOT blocked.
 *
 * NEVER import this module in client-side code. The banned-word list must not
 * be exposed in the browser bundle.
 */

// ── Homoglyph map (Unicode lookalikes → ASCII) ──────────────────────────────
// Covers common Cyrillic, Greek, and special characters used to bypass filters.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  '\u0430': 'a', '\u0435': 'e', '\u0456': 'i', '\u043e': 'o',
  '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0443': 'u',
  '\u0410': 'a', '\u0415': 'e', '\u041e': 'o', '\u0420': 'p',
  '\u0421': 'c', '\u0425': 'x',
  // Greek
  '\u03b1': 'a', '\u03b5': 'e', '\u03b9': 'i', '\u03bf': 'o',
  '\u03c5': 'u', '\u03bd': 'v', '\u03ba': 'k',
  '\u0391': 'a', '\u0395': 'e', '\u039f': 'o',
  // Fullwidth Latin
  '\uff41': 'a', '\uff42': 'b', '\uff43': 'c', '\uff44': 'd',
  '\uff45': 'e', '\uff46': 'f', '\uff47': 'g', '\uff48': 'h',
  '\uff49': 'i', '\uff4a': 'j', '\uff4b': 'k', '\uff4c': 'l',
  '\uff4d': 'm', '\uff4e': 'n', '\uff4f': 'o', '\uff50': 'p',
  '\uff51': 'q', '\uff52': 'r', '\uff53': 's', '\uff54': 't',
  '\uff55': 'u', '\uff56': 'v', '\uff57': 'w', '\uff58': 'x',
  '\uff59': 'y', '\uff5a': 'z',
}

// ── Normalisation pipeline ───────────────────────────────────────────────────

function replaceHomoglyphs(text: string): string {
  return text.split('').map((ch) => HOMOGLYPHS[ch] ?? ch).join('')
}

function replaceLeet(text: string): string {
  return text
    .replace(/@/g, 'a')
    .replace(/4/g, 'a')
    .replace(/3/g, 'e')
    .replace(/[!1|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\$/g, 's')
    .replace(/8/g, 'b')
    .replace(/\+/g, 't')
}

// Remove zero-width characters and unusual Unicode spaces
function stripInvisible(text: string): string {
  return text.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g, '')
}

// Collapse 3+ repeated characters to 2: "haaate" → "haate", "loooove" → "looove"
// (2 so "ass" → still "ass", "aass" → "aass")
function collapseRepeats(text: string): string {
  return text.replace(/(.)\1{2,}/g, '$1$1')
}

// Remove punctuation/spaces that are inserted between the letters of a word
// e.g. "f.u.c.k" → "fuck", "n-i-g" → "nig", "w o r d" → "word"
// Only applies when the pattern is clearly letter-by-letter (single chars separated)
function removeSeparators(text: string): string {
  // Match single letter separated by one non-alphanumeric, repeated at least 3 times
  return text.replace(/\b([a-z])[\s\-_.]{1,2}(?=[a-z][\s\-_.]{0,2}[a-z])/g, '$1')
    .replace(/([a-z])\s([a-z])\s([a-z])/g, '$1$2$3')
}

function normalise(text: string): string {
  return collapseRepeats(
    removeSeparators(
      replaceLeet(
        replaceHomoglyphs(
          stripInvisible(text.toLowerCase())
        )
      )
    )
  )
}

// ── Academic / journalistic context detection ────────────────────────────────
// If a slur appears inside quotes preceded by known academic framing, allow it
// through but flag for admin review rather than blocking.

const ACADEMIC_PREFIXES = [
  /the term\s+["'"]/i,
  /the (word|slur|phrase)\s+["'"]/i,
  /historically (referred|known|described) (to|as)\s+["'"]/i,
  /(?:quote[sd]?|citing)\s+["'"]/i,
  /in (quotes?|quotation marks?)/i,
]

function isAcademicContext(original: string, matchIndex: number): boolean {
  const preceding = original.slice(Math.max(0, matchIndex - 80), matchIndex)
  return ACADEMIC_PREFIXES.some((re) => re.test(preceding))
}

// ── Banned patterns ──────────────────────────────────────────────────────────
//
// Each entry is a regex applied to the NORMALISED text.
// category is for internal logging only - never exposed to clients.

interface BannedPattern {
  pattern: RegExp
  category: string
}

const BANNED: BannedPattern[] = [
  // ── Racial / ethnic slurs ─────────────────────────────────────────────────
  { pattern: /\bn[i]+g+[ae]r/, category: 'racial_slur' },
  { pattern: /\bn[i]+g+[sz]/, category: 'racial_slur' },
  { pattern: /\bnigg+a/, category: 'racial_slur' },
  { pattern: /\bcoon\b/, category: 'racial_slur' },
  { pattern: /\bspic+k?\b/, category: 'racial_slur' },
  { pattern: /\bbeaner\b/, category: 'racial_slur' },
  { pattern: /\bwetback\b/, category: 'racial_slur' },
  { pattern: /\bchink\b/, category: 'racial_slur' },
  { pattern: /\bgook\b/, category: 'racial_slur' },
  { pattern: /\bjap\b/, category: 'racial_slur' },
  { pattern: /\bzip(per)?head\b/, category: 'racial_slur' },
  { pattern: /\bkike\b/, category: 'racial_slur' },
  { pattern: /\bhebrew\s*slur/, category: 'racial_slur' },
  { pattern: /\bwop\b/, category: 'racial_slur' },
  { pattern: /\bmick\b/, category: 'racial_slur' },
  { pattern: /\bkraut\b/, category: 'racial_slur' },
  { pattern: /\bsand\s?ni+g/, category: 'racial_slur' },
  { pattern: /\bpaki\b/, category: 'racial_slur' },
  { pattern: /\bdarkie\b/, category: 'racial_slur' },
  { pattern: /\bsambo\b/, category: 'racial_slur' },
  { pattern: /\bzipper\s?head\b/, category: 'racial_slur' },
  { pattern: /\bwigger\b/, category: 'racial_slur' },
  { pattern: /\bcamel\s?jockey\b/, category: 'racial_slur' },
  { pattern: /\braghead\b/, category: 'racial_slur' },
  { pattern: /\btowelhead\b/, category: 'racial_slur' },
  { pattern: /\bjigab[oo]+\b/, category: 'racial_slur' },
  { pattern: /\bporch\s?monkey\b/, category: 'racial_slur' },
  { pattern: /\bwatermelon\s+(?:eating\s+)?n[i]+g/, category: 'racial_slur' },

  // ── Homophobic / transphobic slurs ────────────────────────────────────────
  { pattern: /\bfa+g+[ot]+\b/, category: 'homophobic_slur' },
  { pattern: /\bfag\b/, category: 'homophobic_slur' },
  { pattern: /\bdyke\b/, category: 'homophobic_slur' },
  { pattern: /\bqueer\b/, category: 'homophobic_slur' },  // context-dependent; flag but allow
  { pattern: /\btrann[yi]\b/, category: 'transphobic_slur' },
  { pattern: /\bshemale\b/, category: 'transphobic_slur' },
  { pattern: /\bhe-?she\b/, category: 'transphobic_slur' },
  { pattern: /\bit\s+is\s+(?:really\s+)?a\s+(?:man|woman)\b/, category: 'transphobic_harassment' },

  // ── Misogynistic / sexist slurs ───────────────────────────────────────────
  { pattern: /\bcunt\b/, category: 'misogynistic_slur' },
  { pattern: /\bslut\b/, category: 'misogynistic_slur' },
  { pattern: /\bwhore\b/, category: 'misogynistic_slur' },
  { pattern: /\bskank\b/, category: 'misogynistic_slur' },
  { pattern: /\btwat\b/, category: 'misogynistic_slur' },
  { pattern: /\bcock\s?sucker/, category: 'misogynistic_slur' },

  // ── Ableist slurs ─────────────────────────────────────────────────────────
  { pattern: /\bretard(ed)?\b/, category: 'ableist_slur' },
  { pattern: /\bspastic\b/, category: 'ableist_slur' },
  { pattern: /\bmongtard\b/, category: 'ableist_slur' },
  { pattern: /\bm[o0]ng\b/, category: 'ableist_slur' },

  // ── Religious hate speech ─────────────────────────────────────────────────
  { pattern: /\bislam(ic)?\s+terrorist/, category: 'religious_hate' },
  { pattern: /\bmuslim\s+(pig|terrorist|bomb(er)?s?)/, category: 'religious_hate' },
  { pattern: /\bjew+ish?\s+(control|conspir|evil|greed)/, category: 'religious_hate' },
  { pattern: /\ball\s+(?:muslims?|jews?|christians?|hindus?)\s+(should|must|need to)\s+(die|leave|be\s+killed)/, category: 'religious_hate' },

  // ── Targeted harassment / threats ─────────────────────────────────────────
  { pattern: /\bkill\s+your?self\b/, category: 'targeted_harassment' },
  { pattern: /\byou\s+should\s+(die|kill\s+(your?self|themselves?))\b/, category: 'targeted_harassment' },
  { pattern: /\bgo\s+(die|hang\s+your?self|kill\s+your?self)\b/, category: 'targeted_harassment' },
  { pattern: /\bi\s+(will|want\s+to|am\s+going\s+to)\s+(kill|murder|hurt|rape)\s+you\b/, category: 'threat' },
  { pattern: /\bi\s+hope\s+you\s+(die|get\s+(cancer|aids|shot))\b/, category: 'targeted_harassment' },
  { pattern: /\bdo\s+the\s+world\s+a\s+(favour|favor)\s+and\s+(die|kill)/, category: 'targeted_harassment' },
  { pattern: /\bno\s+one\s+would\s+miss\s+you\b/, category: 'targeted_harassment' },
  { pattern: /\byou\s+(don't|do\s+not)\s+deserve\s+to\s+live\b/, category: 'targeted_harassment' },
  { pattern: /\brape\s+(her|him|them|you)\b/, category: 'threat' },
]

// These patterns require word-boundary context - "queer" can be reclaimed
// or used in academic contexts so we flag but don't block.
const FLAG_ONLY: BannedPattern[] = [
  { pattern: /\bqueer\b/, category: 'contextual_slur' },
  { pattern: /\bdyke\b/, category: 'contextual_slur' },
]

// ── Public API ───────────────────────────────────────────────────────────────

export interface FilterResult {
  allowed: boolean
  reason?: string
  flagForReview?: boolean
  flagReason?: string
}

/**
 * filterComment - run before storing any user-submitted comment.
 *
 * Returns:
 *   { allowed: false }               - block; do not store
 *   { allowed: true, flagForReview } - store but mark for admin review
 *   { allowed: true }                - clean; store normally
 */
export function filterComment(text: string): FilterResult {
  const norm = normalise(text)

  for (const { pattern, category } of BANNED) {
    const match = norm.match(pattern)
    if (match) {
      const matchIndex = norm.indexOf(match[0])
      // Academic context: allow with flag
      if (isAcademicContext(text, matchIndex)) {
        return { allowed: true, flagForReview: true, flagReason: 'academic_mention' }
      }
      // FLAG_ONLY patterns: allow with flag
      if (FLAG_ONLY.some((fp) => fp.pattern.source === pattern.source)) {
        return { allowed: true, flagForReview: true, flagReason: category }
      }
      return {
        allowed: false,
        reason: 'Your comment contains content that violates our community standards and could not be posted.',
      }
    }
  }

  // Check flag-only patterns separately (they don't block)
  for (const { pattern, category } of FLAG_ONLY) {
    if (pattern.test(norm)) {
      return { allowed: true, flagForReview: true, flagReason: category }
    }
  }

  return { allowed: true }
}

/**
 * filterContent - same detection logic but never blocks (editors are trusted).
 * Used for debate article content submitted through the creator.
 */
export function filterContent(text: string): FilterResult {
  const result = filterComment(text)
  if (!result.allowed) {
    return { allowed: true, flagForReview: true, flagReason: 'content_filter_hit' }
  }
  return result
}

/**
 * highlightViolations - returns HTML with offending spans highlighted.
 * Used in the admin moderation review UI.
 */
export function highlightViolations(text: string): string {
  let highlighted = text
  const norm = normalise(text)

  for (const { pattern } of [...BANNED, ...FLAG_ONLY]) {
    const match = norm.match(pattern)
    if (match && match.index !== undefined) {
      const word = text.slice(match.index, match.index + match[0].length)
      highlighted = highlighted.replace(
        word,
        `<mark style="background:#fee2e2;color:#991b1b;padding:0 2px">${word}</mark>`,
      )
    }
  }

  return highlighted
}

/** Strip HTML tags from a string - use server-side before storing. */
export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim()
}
