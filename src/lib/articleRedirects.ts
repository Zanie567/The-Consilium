/**
 * Retired article addresses (table article_slug_redirects, written only by the approved slug migration).
 *
 * `/articles/<oldSlug>` is answered by src/proxy.ts with a permanent 301 to the article's current address,
 * before any page code runs. The article page repeats the lookup uncached as a fallback, so a request that
 * reaches it during the proxy's short cache window is still redirected (Next serves that one as a 308,
 * which search engines treat the same way).
 *
 * Only publicly visible articles are redirect targets: a redirect to an unpublished or trashed article
 * would just end in a 404 one hop later, so the old address 404s directly instead.
 */
import { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'

type RedirectDb = Pick<typeof prisma, 'articleSlugRedirect'>

/** How long one server instance reuses the redirect table it read. */
export const REDIRECT_MAP_TTL_MS = 60_000

/** The slug in `/articles/<slug>` (with or without a trailing slash), or null for any other path. */
export function articleSlugFromPath(pathname: string): string | null {
  const match = /^\/articles\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

/** Every retired address whose article is public, mapped to that article's current address. */
export async function loadArticleRedirectMap(db: RedirectDb = prisma): Promise<Map<string, string>> {
  const rows = await db.articleSlugRedirect.findMany({
    where: { article: publishedArticleWhere() },
    select: { oldSlug: true, article: { select: { slug: true } } },
  })
  return new Map(rows.filter((r) => r.oldSlug !== r.article.slug).map((r) => [r.oldSlug, r.article.slug]))
}

/** The current address for a retired one, read directly (no cache). Null when `slug` is not retired. */
export async function findArticleRedirect(slug: string, db: RedirectDb = prisma): Promise<string | null> {
  const row = await db.articleSlugRedirect.findFirst({
    where: { oldSlug: slug, article: publishedArticleWhere() },
    select: { article: { select: { slug: true } } },
  })
  return row && row.article.slug !== slug ? row.article.slug : null
}

/**
 * A per-instance cache of the redirect map. A failed read never throws and never blocks the request: the
 * last good map is kept (or none), and the page-level fallback still redirects.
 */
export function createRedirectResolver(load: () => Promise<Map<string, string>> = loadArticleRedirectMap, ttlMs = REDIRECT_MAP_TTL_MS, now = Date.now) {
  let cached: { map: Map<string, string>; at: number } | null = null
  let pending: Promise<void> | null = null
  return async function resolve(slug: string): Promise<string | null> {
    if (!cached || now() - cached.at > ttlMs) {
      pending ??= load()
        .then((map) => { cached = { map, at: now() } })
        .catch((error) => {
          console.error('[article-redirects] redirect table unavailable', error instanceof Error ? error.message : error)
          // Retry soon, but not on every request.
          cached = { map: cached?.map ?? new Map(), at: now() - ttlMs + 5_000 }
        })
        .finally(() => { pending = null })
      await pending
    }
    return cached?.map.get(slug) ?? null
  }
}

export const resolveArticleRedirect = createRedirectResolver()
