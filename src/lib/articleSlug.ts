/**
 * Article web addresses (`/articles/<slug>`).
 *
 * Lifecycle
 *   1. A new article holds a PROVISIONAL slug (`draft-<digits>`). It is internal: drafts are never public,
 *      and keeping it while the title is still being written means autosave never bakes a half-typed
 *      headline into the address, and title edits never churn it.
 *   2. The first time the article is submitted for review, scheduled or published, a provisional slug is
 *      replaced by one built from the title (`finalSlugForTransition`). Editors see it in review and can
 *      change it until publication.
 *   3. Publication locks it (`slugLockedAt`, also enforced by the database trigger articles_slug_guard).
 *      After that only the approved migration (scripts/migrate-article-slugs.ts) changes it, and that
 *      records a permanent 301 redirect from the old address (article_slug_redirects).
 *
 * Every slug is lowercase ASCII words joined by single hyphens, and unique across live articles, trashed
 * articles (the unique index covers every row) and retired addresses.
 */
import slugify from 'slugify'

export const SLUG_MAX_LENGTH = 80
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PROVISIONAL_PATTERN = /^draft-\d+$/

/** True for an address that was never chosen: the autosave placeholder, or a legacy empty slug. */
export function isProvisionalSlug(slug: string | null | undefined): boolean {
  return !slug || PROVISIONAL_PATTERN.test(slug)
}

/** A fresh placeholder for a new draft. The random tail keeps two drafts created in the same millisecond apart. */
export function provisionalSlug(now = Date.now(), random = Math.random): string {
  return `draft-${now}${Math.floor(random() * 1000).toString().padStart(3, '0')}`
}

/**
 * The descriptive address for a title: lowercase, hyphenated, ASCII only, at most SLUG_MAX_LENGTH
 * characters, cut at a word boundary. Empty when the title has no usable characters.
 */
export function slugFromTitle(title: string): string {
  const full = slugify(typeof title === 'string' ? title : '', { lower: true, strict: true, trim: true })
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (full.length <= SLUG_MAX_LENGTH) return full
  const cut = full.slice(0, SLUG_MAX_LENGTH + 1)
  const boundary = cut.lastIndexOf('-')
  return (boundary > 0 ? cut.slice(0, boundary) : full.slice(0, SLUG_MAX_LENGTH)).replace(/-$/, '')
}

export type SlugValidation = { ok: true; slug: string } | { ok: false; error: string }

/**
 * Validate an address an editor typed. Light normalisation (case, spaces, accents) is applied, so
 * "Tulip Mania" becomes "tulip-mania"; anything that still is not a clean address is refused.
 */
export function validateCustomSlug(input: unknown): SlugValidation {
  if (typeof input !== 'string') return { ok: false, error: 'The web address must be text.' }
  const slug = slugify(input, { lower: true, strict: true, trim: true }).replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!slug) return { ok: false, error: 'The web address needs at least one letter or number.' }
  if (slug.length < 3) return { ok: false, error: 'The web address must be at least 3 characters.' }
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, error: `The web address must be at most ${SLUG_MAX_LENGTH} characters.` }
  if (!SLUG_PATTERN.test(slug)) return { ok: false, error: 'Use lowercase letters, numbers and single hyphens only.' }
  if (PROVISIONAL_PATTERN.test(slug)) return { ok: false, error: 'Addresses of the form draft-<number> are reserved for unsaved drafts.' }
  return { ok: true, slug }
}

/** Statuses that make an article's address visible to someone else (reviewers, the schedule, readers). */
export const SLUG_FINALISING_STATUSES = ['PENDING_REVIEW', 'SCHEDULED', 'PUBLISHED'] as const

/** The two lookups uniqueness needs; satisfied by the Prisma client and by a transaction client. */
export interface SlugDb {
  article: { findUnique(args: { where: { slug: string }; select: { id: true } }): Promise<{ id: string } | null> }
  articleSlugRedirect: { findUnique(args: { where: { oldSlug: string }; select: { id: true } }): Promise<{ id: string } | null> }
}

/** Whether `slug` is free for article `articleId` (taken by another article, trashed or not, or by a retired address). */
export async function isSlugAvailable(db: SlugDb, slug: string, articleId?: string): Promise<boolean> {
  const [article, redirect] = await Promise.all([
    db.article.findUnique({ where: { slug }, select: { id: true } }),
    db.articleSlugRedirect.findUnique({ where: { oldSlug: slug }, select: { id: true } }),
  ])
  return !redirect && (!article || article.id === articleId)
}

/** `base`, or `base-2`, `base-3` … : the first free variant. Never returns a taken address. */
export async function uniqueSlug(db: SlugDb, base: string, articleId?: string): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const suffix = n === 1 ? '' : `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-$/, '')}${suffix}`
    if (await isSlugAvailable(db, candidate, articleId)) return candidate
  }
  // Fifty articles with the same headline: fall back to a short random tail.
  return `${base.slice(0, SLUG_MAX_LENGTH - 7).replace(/-$/, '')}-${Math.random().toString(36).slice(2, 8)}`
}

/** A unique placeholder for a new draft. */
export async function uniqueProvisionalSlug(db: SlugDb): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = provisionalSlug()
    if (await isSlugAvailable(db, candidate)) return candidate
  }
  throw new Error('Could not allocate a draft address; try again.')
}

export interface SlugTransitionInput {
  id?: string
  slug: string
  title: string
  slugLockedAt: Date | null
  /** The status the article holds now (omit for a new article). A published article is always locked. */
  status?: string
}

/**
 * The address an article must carry as it enters `nextStatus`: its current one, unless that is still
 * provisional and the article is becoming visible to someone else, in which case one is built from the
 * title. A locked (ever-published) article always keeps its address. Returns null for "no change".
 */
export async function finalSlugForTransition(
  db: SlugDb,
  article: SlugTransitionInput,
  nextStatus: string,
): Promise<string | null> {
  if (isSlugLocked({ slugLockedAt: article.slugLockedAt, status: article.status ?? 'DRAFT' })) return null
  if (!isProvisionalSlug(article.slug)) return null
  if (!(SLUG_FINALISING_STATUSES as readonly string[]).includes(nextStatus)) return null
  const fromTitle = slugFromTitle(article.title)
  // An untitled article cannot have a descriptive address; give it a neutral, permanent one.
  const base = fromTitle.length >= 3 ? fromTitle : `article-${(article.id ?? '').slice(-8) || Date.now().toString(36)}`
  return uniqueSlug(db, base, article.id)
}

/** The `slugLockedAt` value to write as an article enters `nextStatus` (the database trigger does the same). */
export function slugLockFor(article: { slugLockedAt: Date | null }, nextStatus: string, now: Date): Date | null {
  return article.slugLockedAt ?? (nextStatus === 'PUBLISHED' ? now : null)
}

/** True when the article's address can no longer be changed by ordinary editing. */
export function isSlugLocked(article: { slugLockedAt: Date | null; status: string }): boolean {
  return Boolean(article.slugLockedAt) || article.status === 'PUBLISHED'
}

/** Which database refusal (trigger articles_slug_guard) `error`, or anything it wraps, carries. */
export function slugGuardViolation(error: unknown, depth = 0): 'locked' | 'retired' | null {
  if (!error || depth > 4) return null
  const text = typeof error === 'string' ? error
    : typeof error === 'object' ? `${(error as { message?: unknown }).message ?? ''} ${JSON.stringify((error as { meta?: unknown }).meta ?? '')}`
    : ''
  if (text.includes('ARTICLE_SLUG_LOCKED')) return 'locked'
  if (text.includes('ARTICLE_SLUG_RETIRED')) return 'retired'
  return typeof error === 'object' ? slugGuardViolation((error as { cause?: unknown }).cause, depth + 1) : null
}
