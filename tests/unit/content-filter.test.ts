/**
 * Unit tests for src/lib/content-filter.ts
 *
 * Tests the normalisation pipeline and filterComment / filterContent public API.
 * Importing this module is safe here because vitest runs in Node (server-only).
 */

import { describe, it, expect } from 'vitest'
import { filterComment, filterContent } from '@/lib/content-filter'

// ── Helper ────────────────────────────────────────────────────────────────────

function blocked(text: string) {
  return filterComment(text).allowed === false
}

function allowed(text: string) {
  return filterComment(text).allowed === true
}

function flagged(text: string) {
  const r = filterComment(text)
  return r.allowed === true && r.flagForReview === true
}

// ── 1. Clean content — must never block ───────────────────────────────────────

describe('clean content', () => {
  it('accepts a normal comment', () => {
    expect(allowed('This is a well-reasoned argument.')).toBe(true)
  })

  it('accepts general profanity (not targeting)', () => {
    expect(allowed('This policy is fucking idiotic.')).toBe(true)
  })

  it('accepts political disagreement', () => {
    expect(allowed('Your argument is completely wrong and here is why.')).toBe(true)
  })

  it('accepts academic discussion of racism without slurs', () => {
    expect(allowed('The history of racial discrimination in the US spans centuries.')).toBe(true)
  })

  it('accepts empty string', () => {
    const r = filterComment('')
    expect(r.allowed).toBe(true)
    expect(r.flagForReview).toBeFalsy()
  })

  it('accepts whitespace-only input', () => {
    const r = filterComment('   ')
    expect(r.allowed).toBe(true)
  })
})

// ── 2. Racial slurs — must block ─────────────────────────────────────────────

describe('racial slurs', () => {
  it('blocks the n-word (lowercase)', () => {
    expect(blocked('nigger')).toBe(true)
  })

  it('blocks the n-word (uppercase)', () => {
    expect(blocked('NIGGER')).toBe(true)
  })

  it('blocks paki', () => {
    expect(blocked('you paki')).toBe(true)
  })

  it('blocks chink', () => {
    expect(blocked('chink')).toBe(true)
  })

  it('blocks kike', () => {
    expect(blocked('kike')).toBe(true)
  })

  it('blocks spick', () => {
    expect(blocked('spick')).toBe(true)
  })

  it('blocks wetback', () => {
    expect(blocked('wetback')).toBe(true)
  })
})

// ── 3. Leet-speak bypass attempts — must block ────────────────────────────────

describe('leet-speak normalisation', () => {
  it('blocks n1gg3r', () => {
    expect(blocked('n1gg3r')).toBe(true)
  })

  it('blocks f@gg0t', () => {
    expect(blocked('f@gg0t')).toBe(true)
  })

  it('blocks n!gger (! → i)', () => {
    expect(blocked('n!gger')).toBe(true)
  })

  it('blocks p@ki', () => {
    expect(blocked('p@ki')).toBe(true)
  })

  it('blocks r3t@rd', () => {
    expect(blocked('r3t@rd')).toBe(true)
  })
})

// ── 4. Homoglyph bypass attempts — must block ─────────────────────────────────

describe('homoglyph normalisation (Cyrillic)', () => {
  // 'а' (U+0430 Cyrillic) for 'a', 'е' (U+0435) for 'e'
  it('blocks n-word with Cyrillic а and е', () => {
    expect(blocked('niggеr')).toBe(true)  // Cyrillic е
  })

  it('blocks pаki (Cyrillic а)', () => {
    expect(blocked('pаki')).toBe(true)
  })
})

describe('homoglyph normalisation (fullwidth Latin)', () => {
  // Fullwidth: ｎｉｇｇｅｒ
  it('blocks fullwidth latin slur', () => {
    const fullwidth = 'ｎｉｇｇｅｒ' // ｎｉｇｇｅｒ
    expect(blocked(fullwidth)).toBe(true)
  })
})

describe('homoglyph normalisation (Greek)', () => {
  // Greek ο (U+03BF) for 'o', α (U+03B1) for 'a'
  it('blocks pαki with Greek α', () => {
    expect(blocked('pαki')).toBe(true)
  })
})

// ── 5. Invisible character bypass — must block ────────────────────────────────

describe('invisible character stripping', () => {
  it('blocks slur with zero-width spaces between letters', () => {
    // n​i​g​g​e​r with U+200B between each letter
    const zwsp = '​'
    expect(blocked(`n${zwsp}i${zwsp}g${zwsp}g${zwsp}e${zwsp}r`)).toBe(true)
  })

  it('blocks slur with soft-hyphen (U+00AD) between letters', () => {
    expect(blocked('n­i­g­g­e­r')).toBe(true)
  })

  it('blocks slur with RTL-override character prefix', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE
    expect(blocked('‮nigger')).toBe(true)
  })
})

// ── 6. Separator bypass — must block ─────────────────────────────────────────

describe('separator removal', () => {
  it.fails(
    'BUG-SEP-1: blocks n.i.g.g.e.r (dot separators) — removeSeparators regex does not collapse this pattern',
    () => {
      // The removeSeparators regex requires the lookahead [a-z][sep]{0,2}[a-z], but the
      // multi-char remainder "g.g.e.r" is not matched correctly. Real bypass — not blocked.
      expect(blocked('n.i.g.g.e.r')).toBe(true)
    }
  )

  it.fails(
    'BUG-SEP-2: blocks n-i-g-g-e-r (hyphen separators) — same removeSeparators gap',
    () => {
      expect(blocked('n-i-g-g-e-r')).toBe(true)
    }
  )
})

// ── 7. Character repeat collapse — must block ─────────────────────────────────

describe('repeat collapse', () => {
  it('blocks niiiigger (5 i chars)', () => {
    expect(blocked('niiiigger')).toBe(true)
  })

  it.fails(
    'BUG-REPEAT-1: blocks paaaaaki — collapseRepeats produces "paaki" which does not match /\\bpaki\\b/',
    () => {
      // collapseRepeats: "paaaaaki" → "paaki" (4 a's → 2). Pattern /\bpaki\b/ needs exactly "paki".
      // "paaki" has two a's so it doesn't match. Real bypass.
      expect(blocked('paaaaaki')).toBe(true)
    }
  )
})

// ── 8. Targeted harassment / threats — must block ────────────────────────────

describe('threats and harassment', () => {
  it('blocks "kill yourself"', () => {
    expect(blocked('kill yourself')).toBe(true)
  })

  it('blocks "you should die"', () => {
    expect(blocked('you should die')).toBe(true)
  })

  it('blocks "go die"', () => {
    expect(blocked('go die')).toBe(true)
  })

  it('blocks "i will rape you"', () => {
    expect(blocked('i will rape you')).toBe(true)
  })

  it.fails(
    'BUG-SEP-3: blocks "i hope you get cancer" — removeSeparators merges single-letter "i" into "ihope"',
    () => {
      // removeSeparators: "i " before "hope" — 'i' is a single letter followed by a space,
      // and the lookahead sees 'ho' (letter+letter), so the space is removed → "ihope you get cancer".
      // The threat pattern /\bi\s+hope.../ then has no \b boundary match.
      expect(blocked('i hope you get cancer')).toBe(true)
    }
  )

  it.fails(
    'BUG-SEP-4: blocks "do the world a favour and die" — removeSeparators merges "a" into "afavour"',
    () => {
      // removeSeparators strips the space after "a" when followed by "fa" → "afavour".
      // The threat pattern /\bdo\s+the\s+world\s+a\s+(favour|favor).../ can no longer match.
      expect(blocked('do the world a favour and die')).toBe(true)
    }
  )

  it('blocks "no one would miss you"', () => {
    expect(blocked('no one would miss you')).toBe(true)
  })
})

// ── 9. Homophobic/transphobic slurs — must block ──────────────────────────────

describe('homophobic and transphobic slurs', () => {
  it('blocks faggot', () => {
    expect(blocked('faggot')).toBe(true)
  })

  it('blocks fag', () => {
    expect(blocked('fag')).toBe(true)
  })

  it('blocks tranny', () => {
    expect(blocked('tranny')).toBe(true)
  })

  it('blocks shemale', () => {
    expect(blocked('shemale')).toBe(true)
  })
})

// ── 10. Misogynistic slurs — must block ───────────────────────────────────────

describe('misogynistic slurs', () => {
  it('blocks slut', () => {
    expect(blocked('slut')).toBe(true)
  })

  it('blocks cunt', () => {
    expect(blocked('cunt')).toBe(true)
  })

  it('blocks whore', () => {
    expect(blocked('whore')).toBe(true)
  })
})

// ── 11. Ableist slurs — must block ────────────────────────────────────────────

describe('ableist slurs', () => {
  it('blocks retard', () => {
    expect(blocked('retard')).toBe(true)
  })

  it('blocks spastic', () => {
    expect(blocked('spastic')).toBe(true)
  })
})

// ── 12. Religious hate — must block ──────────────────────────────────────────

describe('religious hate speech', () => {
  it('blocks "islamic terrorist"', () => {
    expect(blocked('islamic terrorist')).toBe(true)
  })

  it('blocks "muslim pig"', () => {
    expect(blocked('muslim pig')).toBe(true)
  })
})

// ── 13. FLAG_ONLY words — allowed but flagged ────────────────────────────────

describe('FLAG_ONLY words (queer, dyke)', () => {
  it('allows "queer" and flags it', () => {
    const r = filterComment('The queer community deserves equal rights.')
    expect(r.allowed).toBe(true)
    expect(r.flagForReview).toBe(true)
  })

  it('does NOT block on "queer"', () => {
    expect(blocked('queer')).toBe(false)
  })

  it.fails(
    'BUG-SEP-5: "dyke" in a sentence is not flagged — removeSeparators merges "a" + "dyke" → "adyke"',
    () => {
      // "a dyke" — 'a' is a single letter before a space before 'dy', which the lookahead matches,
      // so the space is removed → "adyke". The /\bdyke\b/ pattern then finds no word boundary.
      const r = filterComment('She identifies as a dyke and is proud of it.')
      expect(r.allowed).toBe(true)
      expect(r.flagForReview).toBe(true)
    }
  )

  it('does NOT block on "dyke"', () => {
    expect(blocked('dyke')).toBe(false)
  })
})

// ── 14. Academic context exceptions ──────────────────────────────────────────

describe('academic context detection', () => {
  it('allows slur after "the term" with flagReason academic_mention', () => {
    const r = filterComment('Historically, the term "nigger" was used to dehumanise.')
    expect(r.allowed).toBe(true)
    expect(r.flagReason).toBe('academic_mention')
  })

  it('allows slur after "the word" framing', () => {
    const r = filterComment('The word "nigger" appears in this historical document.')
    expect(r.allowed).toBe(true)
    expect(r.flagReason).toBe('academic_mention')
  })

  it.fails(
    'BUG-ACAD-1: "quoting" not in academic prefix list — only quote/quoted/quotes are matched',
    () => {
      // ACADEMIC_PREFIXES includes /(?:quote[sd]?|citing)\s+["'"]/i
      // This matches "quote", "quotes", "quoted" but NOT "quoting".
      // "He was quoting..." triggers a block instead of academic exception.
      const r = filterComment('He was quoting "nigger" from a 1950s court record.')
      expect(r.allowed).toBe(true)
      expect(r.flagReason).toBe('academic_mention')
    }
  )

  it('does NOT grant academic exception for slur with no framing prefix', () => {
    expect(blocked('nigger')).toBe(true)
  })

  it('does NOT grant academic exception for the prefix alone (no slur following)', () => {
    const r = filterComment('The term "racism" has a complex history.')
    expect(r.allowed).toBe(true)
    expect(r.flagForReview).toBeFalsy()
  })
})

// ── 15. Early-exit behaviour with multiple violations ─────────────────────────

describe('multiple violations', () => {
  it('blocks on first violation; does not need to find the second', () => {
    // Both "nigger" and "kill yourself" are in the input; result is simply blocked
    const r = filterComment('nigger — kill yourself')
    expect(r.allowed).toBe(false)
  })
})

// ── 16. filterContent — never blocks, only flags ─────────────────────────────

describe('filterContent (article body)', () => {
  it('does NOT block even when a slur is present', () => {
    const r = filterContent('This article contains the word nigger.')
    expect(r.allowed).toBe(true)
  })

  it('flags article content that contains a slur', () => {
    const r = filterContent('nigger')
    expect(r.flagForReview).toBe(true)
    expect(r.flagReason).toBe('content_filter_hit')
  })

  it('returns clean result for clean article body', () => {
    const r = filterContent('This is a clean economic analysis.')
    expect(r.allowed).toBe(true)
    expect(r.flagForReview).toBeFalsy()
  })
})

// ── 17. Performance ───────────────────────────────────────────────────────────

describe('performance', () => {
  it('processes 10,000 chars of clean text in under 100ms', () => {
    const longText = 'This is a perfectly normal sentence about economic policy. '.repeat(170)
    const start = performance.now()
    filterComment(longText)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  it('processes a slur embedded in 5,000 chars in under 100ms', () => {
    const prefix = 'Clean text. '.repeat(400)
    const text = prefix + 'nigger'
    const start = performance.now()
    filterComment(text)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })
})

// ── 18. Known bugs captured as failing tests ──────────────────────────────────

describe('known bugs (expected failures)', () => {
  it('academic context fires correctly even when ZWS chars surround the slur', () => {
    // The academic prefix check works in this case: ZWS chars are stripped from `norm`
    // but the matchIndex from `norm` is small enough that the preceding 80-char window
    // of `text` (original) still includes "The term" — so the exception fires.
    // The known BUG-CF (index mismatch) does not manifest in this specific layout.
    // It WOULD manifest if the slur appeared after many invisible chars at the start of the string.
    const zwsp = '​'
    const r = filterComment(`The term "${zwsp}nigger${zwsp}" has a historical context.`)
    expect(r.allowed).toBe(true)
    expect(r.flagReason).toBe('academic_mention')
  })
})
