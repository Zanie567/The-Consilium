/**
 * The slug in `/articles/<slug>` (with or without a trailing slash), or null for any other path.
 *
 * Kept apart from src/lib/articleRedirects.ts (which imports Prisma) so that src/proxy.ts can test every
 * request's path without loading a database client; the lookup itself is imported only for article paths.
 */
export function articleSlugFromPath(pathname: string): string | null {
  const match = /^\/articles\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
