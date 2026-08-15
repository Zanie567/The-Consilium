/**
 * Pure query-string helpers for the public /archive listing.
 *
 * These live here rather than inline in `src/app/archive/page.tsx` so they can
 * be unit-tested without pulling Prisma and the server-component tree into the
 * test process — the same reason article render logic moved into
 * `src/lib/articleRender.ts`.
 */

/** Articles shown per archive page. */
export const ARCHIVE_PAGE_SIZE = 20

/**
 * Longest search term forwarded to Postgres. Mirrors the cap the public search
 * endpoint already applies (`src/app/api/search/route.ts`), so a crafted URL
 * cannot push an unbounded string into an `ILIKE '%…%'` scan of the article
 * table.
 */
export const ARCHIVE_MAX_QUERY_LENGTH = 200

/**
 * The real type of a single `searchParams` entry.
 *
 * Next resolves a repeated query parameter (`/archive?q=a&q=b`) to a string
 * array, so every value is `string | string[] | undefined` however narrowly a
 * page declares its props — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
 */
export type SearchParamValue = string | string[] | undefined

/**
 * Collapse a `searchParams` entry to a single string.
 *
 * Repeated parameters used to reach Prisma as an array, which threw a
 * validation error the archive's count query turned into a 500 for anyone who
 * visited `/archive?q=a&q=b`. Taking the first value keeps that URL working
 * instead of failing.
 */
export function firstParam(value: SearchParamValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}

/**
 * Escape the characters Postgres treats as LIKE metacharacters.
 *
 * Prisma compiles `contains` to `ILIKE ('%' || $n || '%')` and exposes no
 * ESCAPE clause, so an unescaped `%` or `_` from the query string is read as a
 * wildcard: `/archive?q=%` matched — and reported a count for — every
 * published article, and a search for "100%" could never find a literal
 * percent sign. Backslash is Postgres' default LIKE escape character, so
 * escaping these three characters is sufficient. The value still travels as a
 * bound parameter and is never concatenated into SQL.
 *
 * Written as an explicit character walk rather than a pattern replacement so
 * that escaping the escape character itself stays obvious and order-independent.
 */
export function escapeLikePattern(value: string): string {
  let escaped = ''
  for (const char of value) {
    if (char === '\\' || char === '%' || char === '_') escaped += '\\'
    escaped += char
  }
  return escaped
}

/**
 * Normalise the reader's search term: collapse repeats, trim, and cap the
 * length. Returns undefined when nothing searchable is left, so callers can
 * drop the `OR` filter entirely rather than search for an empty string.
 */
export function normaliseSearchTerm(value: SearchParamValue): string | undefined {
  const term = firstParam(value)?.trim().slice(0, ARCHIVE_MAX_QUERY_LENGTH)
  return term ? term : undefined
}

/**
 * Parse the requested page number.
 *
 * Anything that is not a positive, safe integer — absent, empty, `0`,
 * negative, non-numeric, fractional, `Infinity`, oversized, or a repeated
 * parameter — falls back to page 1 rather than reaching Prisma, where a
 * non-finite or fractional `skip` throws. `parseInt` also matches the idiom
 * used by the repo's paginated API routes.
 */
export function parsePageParam(value: SearchParamValue): number {
  const parsed = Number.parseInt(firstParam(value) ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

/** Number of pages a result count spans. Always at least 1, so an empty archive still has a page 1. */
export function totalPageCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1
  return Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE))
}

/**
 * Clamp a requested page into the range that exists.
 *
 * Out-of-range pages land on the nearest real page rather than 404ing: unlike
 * an unknown slug, `?page=999` names a page of a resource that does exist, and
 * clamping matches how the glossary admin table already handles the same case.
 */
export function clampPage(requestedPage: number, totalPages: number): number {
  const pages = Math.max(1, totalPages)
  if (!Number.isFinite(requestedPage)) return 1
  return Math.min(Math.max(1, Math.floor(requestedPage)), pages)
}

/** Offset for a (already clamped) page number. */
export function pageOffset(page: number): number {
  return (Math.max(1, page) - 1) * ARCHIVE_PAGE_SIZE
}

/**
 * Build an `/archive` URL for `pageNum`, preserving the active filters.
 * `page=1` is omitted so the first page keeps exactly one address.
 */
export function buildArchiveHref(pageNum: number, q?: string, categorySlug?: string): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (categorySlug) params.set('category', categorySlug)
  if (pageNum > 1) params.set('page', String(pageNum))
  const queryString = params.toString()
  return queryString ? `/archive?${queryString}` : '/archive'
}
