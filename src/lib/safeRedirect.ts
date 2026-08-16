/**
 * Post-login redirect targets taken from the query string.
 *
 * `/login?callbackUrl=…` is handed straight to `window.location.replace()`
 * after a successful sign-in. NextAuth's own `redirect` callback would have
 * rejected an off-site URL, but the credentials form calls
 * `signIn(..., { redirect: false })` and navigates itself, so nothing was
 * checking the value: `/login?callbackUrl=https://evil.example` sent a
 * freshly-authenticated user off the site. Everything that feeds a browser
 * navigation from user input goes through here instead.
 */

import { firstParam, type SearchParamValue } from '@/lib/searchText'

/**
 * Reduce an untrusted `callbackUrl` to a path on this site, falling back to
 * `fallback` for anything else.
 *
 * Accepts only a single-slash-rooted path. Rejected forms, each of which a
 * browser would treat as another origin:
 *   * `https://evil.example` — absolute URL
 *   * `//evil.example`       — protocol-relative
 *   * `/\evil.example`       — backslash variant browsers normalise to `//`
 *   * `javascript:…`         — scheme with no leading slash at all
 *
 * Parsing is deliberately avoided: `new URL()` resolves relative inputs against
 * a base and would report an attacker's absolute URL as same-origin if the base
 * were wrong. A prefix check cannot be fooled that way.
 */
export function safeCallbackPath(value: SearchParamValue, fallback = '/'): string {
  const raw = firstParam(value)?.trim()
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  // A control character here would be stripped by the browser before the
  // navigation, potentially re-forming one of the rejected shapes above.
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return fallback
  }
  return raw
}
