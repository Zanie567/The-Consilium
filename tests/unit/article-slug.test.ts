/**
 * Article web addresses (src/lib/articleSlug.ts): generation from titles, validation, collisions, and when
 * a draft's placeholder becomes a permanent, descriptive address.
 *
 * Regression: an article's first autosave stored `draft-<timestamp>` (or a slug cut from a half-typed
 * headline), and that address went live unchanged — two of the four articles launched on 2026-10-23 are
 * still at /articles/draft-1791210392433 and /articles/draft-1785172614450.
 */
import { describe, expect, it } from 'vitest'
import {
  SLUG_MAX_LENGTH,
  finalSlugForTransition,
  isProvisionalSlug,
  isSlugAvailable,
  isSlugLocked,
  provisionalSlug,
  slugFromTitle,
  slugGuardViolation,
  slugLockFor,
  uniqueSlug,
  validateCustomSlug,
  type SlugDb,
} from '@/lib/articleSlug'

/** A database with these article slugs (id = `id-<slug>`) and retired addresses. */
function fakeDb(articleSlugs: string[], retired: string[] = []): SlugDb & { lookups: string[] } {
  const lookups: string[] = []
  return {
    lookups,
    article: {
      findUnique: async ({ where }) => {
        lookups.push(where.slug)
        return articleSlugs.includes(where.slug) ? { id: `id-${where.slug}` } : null
      },
    },
    articleSlugRedirect: {
      findUnique: async ({ where }) => (retired.includes(where.oldSlug) ? { id: `r-${where.oldSlug}` } : null),
    },
  }
}

describe('slugFromTitle', () => {
  it.each([
    // The titles of the articles launched on 2026-10-23, and of drafts in production on 2026-10-24.
    ['Will SI stocks make you rich in 2026?', 'will-si-stocks-make-you-rich-in-2026'],
    ['Tulip Mania: Lessons from the 17th century', 'tulip-mania-lessons-from-the-17th-century'],
    ['The Unintended Consequences of Sanctions', 'the-unintended-consequences-of-sanctions'],
    ['When Development Goals Collide - Who Decides What Counts as Progress?', 'when-development-goals-collide-who-decides-what-counts-as-progress'],
    ['Gulf Oil Is Back. Can Tar Sands Giants Keep Rising?', 'gulf-oil-is-back-can-tar-sands-giants-keep-rising'],
    // Punctuation, apostrophes, accents, symbols, repeated separators and stray whitespace.
    ["India's  pharma — patents & trade", 'indias-pharma-patents-and-trade'],
    ['  Économie politique: São Paulo  ', 'economie-politique-sao-paulo'],
    ['A/B -- testing -- the   market', 'ab-testing-the-market'],
  ])('%s -> %s', (title, slug) => {
    expect(slugFromTitle(title)).toBe(slug)
  })

  it('is lowercase and hyphenated with no leading, trailing or double hyphens', () => {
    for (const title of ['--Hello--World--', '¿Qué pasa?', 'UPPER case', '100% Growth!!!']) {
      const slug = slugFromTitle(title)
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('cuts long titles at a word boundary within the limit', () => {
    const slug = slugFromTitle("Without Touching the Law: How Trade Deals Could Still Undo India's Pharma Patent Defences")
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug).toBe('without-touching-the-law-how-trade-deals-could-still-undo-indias-pharma-patent')
    expect(slugFromTitle('x'.repeat(200))).toHaveLength(SLUG_MAX_LENGTH)
  })

  it('returns an empty string for titles with nothing usable, including non-strings', () => {
    expect(slugFromTitle('')).toBe('')
    expect(slugFromTitle('?!…')).toBe('')
    expect(slugFromTitle(42 as unknown as string)).toBe('')
  })
})

describe('provisional placeholders', () => {
  it('recognises draft-<digits> and the legacy empty slug, nothing else', () => {
    expect(isProvisionalSlug('draft-1791210392433')).toBe(true)
    expect(isProvisionalSlug('')).toBe(true)
    expect(isProvisionalSlug(null)).toBe(true)
    expect(isProvisionalSlug('draft-policy')).toBe(false)
    expect(isProvisionalSlug('tulip-mania')).toBe(false)
    expect(isProvisionalSlug('my-draft-1791210392433')).toBe(false)
  })

  it('makes placeholders that are provisional and differ within the same millisecond', () => {
    const a = provisionalSlug(1_792_875_915_237, () => 0.1)
    const b = provisionalSlug(1_792_875_915_237, () => 0.9)
    expect(isProvisionalSlug(a)).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('validateCustomSlug', () => {
  it('normalises case, spaces and accents', () => {
    expect(validateCustomSlug('  Tulip Mania ')).toEqual({ ok: true, slug: 'tulip-mania' })
    expect(validateCustomSlug('Café-Économie')).toEqual({ ok: true, slug: 'cafe-economie' })
  })

  it('refuses empty, too short, too long, non-text and reserved placeholder addresses', () => {
    expect(validateCustomSlug('').ok).toBe(false)
    expect(validateCustomSlug('!!!').ok).toBe(false)
    expect(validateCustomSlug('ab').ok).toBe(false)
    expect(validateCustomSlug('a'.repeat(SLUG_MAX_LENGTH + 1)).ok).toBe(false)
    expect(validateCustomSlug(123).ok).toBe(false)
    expect(validateCustomSlug('draft-1791210392433').ok).toBe(false)
  })
})

describe('uniqueness and collisions', () => {
  it('takes the base when free, else the first free -2, -3 …', async () => {
    expect(await uniqueSlug(fakeDb([]), 'tulip-mania')).toBe('tulip-mania')
    expect(await uniqueSlug(fakeDb(['tulip-mania']), 'tulip-mania')).toBe('tulip-mania-2')
    expect(await uniqueSlug(fakeDb(['tulip-mania', 'tulip-mania-2']), 'tulip-mania')).toBe('tulip-mania-3')
  })

  it('treats a retired address (a 301) as taken, so a new article can never shadow a redirect', async () => {
    const db = fakeDb([], ['draft-1785172614450', 'tulip-mania'])
    expect(await isSlugAvailable(db, 'tulip-mania')).toBe(false)
    expect(await uniqueSlug(db, 'tulip-mania')).toBe('tulip-mania-2')
  })

  it('an article does not collide with itself', async () => {
    expect(await isSlugAvailable(fakeDb(['tulip-mania']), 'tulip-mania', 'id-tulip-mania')).toBe(true)
    expect(await isSlugAvailable(fakeDb(['tulip-mania']), 'tulip-mania', 'someone-else')).toBe(false)
  })

  it('keeps suffixed variants within the length limit', async () => {
    const base = 'a'.repeat(SLUG_MAX_LENGTH)
    const slug = await uniqueSlug(fakeDb([base]), base)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug.endsWith('-2')).toBe(true)
  })
})

describe('finalSlugForTransition: when a placeholder becomes the permanent address', () => {
  const draft = { id: 'cmuvcf4eb000204jp254gpqci', slug: 'draft-1791210392433', title: 'Will SI stocks make you rich in 2026?', slugLockedAt: null }

  it('keeps the placeholder while the article stays a draft (title edits never churn the address)', async () => {
    const db = fakeDb([])
    for (const status of ['DRAFT', 'REJECTED', 'ARCHIVED']) {
      expect(await finalSlugForTransition(db, draft, status)).toBeNull()
    }
    expect(db.lookups).toEqual([])
  })

  it.each(['PENDING_REVIEW', 'SCHEDULED', 'PUBLISHED'])('builds it from the title on %s', async (status) => {
    expect(await finalSlugForTransition(fakeDb([]), draft, status)).toBe('will-si-stocks-make-you-rich-in-2026')
  })

  it('uses the latest title, avoiding collisions', async () => {
    const db = fakeDb(['tulip-mania-lessons-from-the-17th-century'])
    expect(await finalSlugForTransition(db, { ...draft, title: 'Tulip Mania: Lessons from the 17th century' }, 'PUBLISHED'))
      .toBe('tulip-mania-lessons-from-the-17th-century-2')
  })

  it('never replaces an address an editor chose', async () => {
    expect(await finalSlugForTransition(fakeDb([]), { ...draft, slug: 'si-stocks' }, 'PUBLISHED')).toBeNull()
  })

  it('never changes a locked or currently published address, even a placeholder (that needs the migration)', async () => {
    expect(await finalSlugForTransition(fakeDb([]), { ...draft, slugLockedAt: new Date() }, 'PUBLISHED')).toBeNull()
    expect(await finalSlugForTransition(fakeDb([]), { ...draft, status: 'PUBLISHED' }, 'PUBLISHED')).toBeNull()
  })

  it('repairs the legacy empty slug and gives untitled articles a neutral address', async () => {
    expect(await finalSlugForTransition(fakeDb([]), { ...draft, slug: '' }, 'PENDING_REVIEW')).toBe('will-si-stocks-make-you-rich-in-2026')
    expect(await finalSlugForTransition(fakeDb([]), { ...draft, title: '' }, 'PUBLISHED')).toBe(`article-${draft.id.slice(-8)}`)
  })
})

describe('locking', () => {
  it('locks at first publication and never unlocks', () => {
    const now = new Date('2026-10-23T08:00:08.610Z')
    expect(slugLockFor({ slugLockedAt: null }, 'PUBLISHED', now)).toEqual(now)
    expect(slugLockFor({ slugLockedAt: null }, 'SCHEDULED', now)).toBeNull()
    const earlier = new Date('2026-10-01T00:00:00Z')
    expect(slugLockFor({ slugLockedAt: earlier }, 'DRAFT', now)).toEqual(earlier)
  })

  it('an unpublished article that was ever published stays locked', () => {
    expect(isSlugLocked({ slugLockedAt: new Date(), status: 'DRAFT' })).toBe(true)
    expect(isSlugLocked({ slugLockedAt: null, status: 'PUBLISHED' })).toBe(true)
    expect(isSlugLocked({ slugLockedAt: null, status: 'PENDING_REVIEW' })).toBe(false)
  })

  it('recognises the database trigger refusals, however Prisma wraps them', () => {
    expect(slugGuardViolation(new Error('ERROR: ARTICLE_SLUG_LOCKED: the web address of article x is permanent'))).toBe('locked')
    expect(slugGuardViolation({ message: 'x', meta: { message: 'ARTICLE_SLUG_RETIRED: tulip' } })).toBe('retired')
    expect(slugGuardViolation({ message: 'outer', cause: new Error('ARTICLE_SLUG_LOCKED') })).toBe('locked')
    expect(slugGuardViolation(new Error('unrelated'))).toBeNull()
  })
})
