/**
 * Primitives for handling untrusted text on its way into a Prisma text filter.
 *
 * Every public search surface needs the same three things — collapse a repeated
 * query parameter, drop characters Postgres cannot store, and neutralise LIKE
 * wildcards — and they drifted apart once already: `/archive` matched every
 * published article for `?q=%` while `/api/search` had a length cap the archive
 * lacked. Keeping them here means a surface either uses the whole set or is
 * visibly not using it.
 */

/**
 * The real type of a single `searchParams` entry.
 *
 * Next resolves a repeated query parameter (`?q=a&q=b`) to a string array, so
 * every value is `string | string[] | undefined` however narrowly a page
 * declares its props — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
 * Route handlers reading `new URL(req.url).searchParams.get()` get
 * `string | null` instead and are not exposed to this.
 */
export type SearchParamValue = string | string[] | undefined

/**
 * Collapse a `searchParams` entry to a single string.
 *
 * Repeated parameters used to reach Prisma as an array, which threw a
 * validation error that an uncaught count query turned into a 500 for anyone
 * who visited `/archive?q=a&q=b`.
 */
export function firstParam(value: SearchParamValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}

/**
 * Strip the control characters a Postgres `text` value cannot carry.
 *
 * A NUL from the query string (`?q=%00`) survives URL decoding as an ordinary
 * JavaScript character and passes Prisma's validation, then fails the query
 * itself with `invalid byte sequence for encoding "UTF8": 0x00` — so a crafted
 * URL could break the request rather than simply find nothing. The rest of the
 * C0 range and DEL go with it; none of them is something a reader can
 * meaningfully search for.
 */
export function stripControlCharacters(value: string): string {
  let stripped = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) stripped += char
  }
  return stripped
}

/**
 * Escape the characters Postgres treats as LIKE metacharacters.
 *
 * Prisma compiles `contains`/`startsWith`/`endsWith` to `ILIKE ('%' || $n ||
 * '%')` and exposes no ESCAPE clause, so an unescaped `%` or `_` from user
 * input is read as a wildcard: `?q=%` matched every published article, and a
 * search for "100%" could never find a literal percent sign. Backslash is
 * Postgres' default LIKE escape character, so escaping these three characters
 * is sufficient. The value still travels as a bound parameter and is never
 * concatenated into SQL — this is wrong-results and scan-cost hardening, not an
 * injection fix.
 *
 * Apply this ONLY to the value handed to the database. Anything that also
 * matches the term in JavaScript (highlighting, scoring, snippets) must keep
 * the unescaped text.
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
 * Normalise untrusted search text: collapse repeats, drop control characters,
 * trim, and cap the length. Returns undefined when nothing usable is left, so
 * callers can drop the filter rather than match on an empty string.
 *
 * The length cap is what actually bounds the cost of a search: `ILIKE '%…%'`
 * over unindexed columns is a sequential scan whose expense tracks the length
 * of the term, not whether it contains wildcards.
 */
export function normaliseSearchText(
  value: SearchParamValue,
  maxLength: number
): string | undefined {
  const raw = firstParam(value)
  if (raw === undefined) return undefined
  const cleaned = stripControlCharacters(raw).trim().slice(0, maxLength)
  return cleaned ? cleaned : undefined
}
