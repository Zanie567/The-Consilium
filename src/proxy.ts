import { TESTING_COOKIE } from '@/lib/testingSessionConstants'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { articleSlugFromPath } from '@/lib/articleRedirectPath'

// The testing-workspace checks need the database (src/lib/testingMode.ts imports Prisma, which
// builds a client as soon as it loads). Load them only when testing mode is on, so a production
// proxy instance never pays to start a database client it cannot use.
const loadTestingMode = () => import('@/lib/testingMode')
// Same for the retired-article-address lookup (Prisma): loaded only for `/articles/<slug>` requests.
const loadArticleRedirects = () => import('@/lib/articleRedirects')

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/analytics/track',
  '/api/articles',
  '/api/comments',
  '/api/contact',
  // Cron routes carry no session cookie; each one authenticates itself with a
  // constant-time CRON_SECRET check (see src/lib/cronAuth.ts), like
  // /api/publish-scheduled below.
  '/api/cron',
  '/api/debates',
  '/api/editorial/setup',
  '/api/award-trophies',
  '/api/publish-scheduled',
  '/api/search',
  '/api/subscribe',
  '/api/team',
  '/api/ticker',
]
const PUBLIC_PAGE_PREFIXES = [
  '/editorial/login',
  '/editorial/reset-password',
  '/editorial/setup',
  '/login',
  '/reset-password',
]

function isPublicApi(pathname: string) {
  if (process.env.E2E_ISOLATED === '1' && pathname === '/api/test-attestation') return true
  if (/^\/api\/editorial\/articles\/[^/]+\/view$/.test(pathname)) return true
  // Used by the signed-out "Forgot password?" form (POST) and the reset-link page (PATCH). Exact
  // match only: the route has no sub-paths and every other /api/editorial route needs a session.
  if (pathname === '/api/editorial/password-reset') return true
  // Exact match or a `prefix/...` sub-path only. A bare `startsWith(prefix)`
  // fallback would wrongly treat e.g. `/api/teams` as public via `/api/team`,
  // so path-segment matching is enforced here.
  return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function isPublicPage(pathname: string) {
  return PUBLIC_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  // This header is server-owned. A browser may never provide an attestation.
  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.delete('x-consilium-verified-identity')
  if (process.env.TESTING_MODE_ENABLED === '1') {
    try { await (await loadTestingMode()).requireTestingWorkspace() } catch {
      return NextResponse.json({ error: 'Testing workspace is not safely configured.', code: 'TESTING_UNAVAILABLE' }, { status: 503 })
    }
  }

  // A retired article address (approved slug migration) answers with a permanent, server-side 301 to the
  // article's current address, keeping any query string. See src/lib/articleRedirects.ts.
  if (request.method === 'GET' || request.method === 'HEAD') {
    const oldSlug = articleSlugFromPath(pathname)
    const current = oldSlug ? await (await loadArticleRedirects()).resolveArticleRedirect(oldSlug) : null
    if (current) {
      // A fresh URL (not a clone of nextUrl, which would keep a trailing slash and cost a second redirect).
      const target = new URL(`/articles/${encodeURIComponent(current)}${request.nextUrl.search}`, request.url)
      return NextResponse.redirect(target, 301)
    }
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).catch(() => null)

  // Ban enforcement
  const isBannable =
    !pathname.startsWith('/banned') &&
    !pathname.startsWith('/api/auth') &&
    !pathname.startsWith('/login') &&
    !pathname.startsWith('/_next') &&
    !pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|woff|woff2|ttf)$/)

  if (isBannable) {
    if (token?.isBanned && !pathname.startsWith('/api/')) {
      return NextResponse.redirect(new URL('/banned', request.url))
    }
  }

  const requiresSession =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/editorial') ||
    (pathname.startsWith('/api/') && !isPublicApi(pathname))

  if (requiresSession && !isPublicPage(pathname) && !token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // CSRF protection for API routes
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next({ request: { headers: forwardedHeaders } })
  }

  // For all other API routes, enforce same-origin on state-changing methods.
  if (pathname.startsWith('/api/') && !SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host')

    if (origin && host) {
      let originHost: string
      try {
        originHost = new URL(origin).host
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      if (originHost !== host) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  if (process.env.TESTING_MODE_ENABLED === '1' && token?.id && !pathname.startsWith('/api/testing-session')) {
    try {
      const { resolveTestingIdentity, auditTesting } = await loadTestingMode()
      const opaque = request.cookies.get(TESTING_COOKIE)?.value
      const identity = await resolveTestingIdentity(token.id, opaque) ?? await resolveTestingIdentity(token.id)
      const mutating = !SAFE_METHODS.has(request.method)
      // A restricted ordinary account is an authorization denial, not a changed
      // test persona. Keep the normal 403 and useful account feedback. A stale
      // capability still takes the revision path below and can never restore admin powers.
      if (mutating && !opaque && !identity) {
        return NextResponse.json({ error: 'Your account is suspended, inactive, or no longer available. Contact an administrator.', code: 'ACCOUNT_RESTRICTED' }, { status: 403 })
      }
      const expected = identity ? `${identity.administrator.id}:${identity.administrator.testingRevision}:${identity.testing?.id ?? 'normal'}` : null
      if (mutating && (opaque || request.headers.has('x-consilium-identity') || (identity?.administrator.testingRevision ?? 0) > 0) && (pathname.startsWith('/api/') || request.headers.has('next-action'))) {
        // Ordinary accounts also use their own stable page identity in this workspace.
        if (!expected || request.headers.get('x-consilium-identity') !== expected) {
          return NextResponse.json({ error: 'Testing identity changed or expired. Reload before saving.', code: 'TESTING_IDENTITY_CHANGED' }, { status: 409 })
        }
        if (identity?.testing) await auditTesting(identity.administrator.id, identity.effective.id, 'testing:mutation-attempt', {
          sessionId: identity.testing.id, method: request.method, path: pathname,
        })
      }
      if (mutating && expected) forwardedHeaders.set('x-consilium-verified-identity', expected)
      // Never delete capabilities on GET: a response to an old prefetch could
      // arrive after switching and erase the newer cookie. Refreshed pages carry
      // the normal identity after expiry; old forms still fail the revision check.

    } catch {
      return NextResponse.json({ error: 'Testing identity cannot be verified.', code: 'TESTING_UNAVAILABLE' }, { status: 503 })
    }
  }

  return NextResponse.next({ request: { headers: forwardedHeaders } })
}

export const config = {
  matcher: [
    /*
     * Every path except Next.js internals and public asset files. The proxy does nothing for an
     * asset (it needs no session, and banned readers were never redirected away from one), but
     * each invocation still costs Vercel CPU.
     *
     * An "asset" is ONE file name with an image/text extension at the site root (logo.png,
     * robots.txt, sitemap.xml, feed.xml, the icons) or directly inside public/brand, public/og or
     * public/team. Nothing under /api, /editorial, /admin or any other path is ever skipped, even
     * with an extension, and the name allows only [A-Za-z0-9._-], so an encoded "/" (%2F) still
     * goes through the proxy. Server Actions post to page paths, which always match.
     * Pinned by tests/unit/proxy-security-contract.test.ts.
     */
    '/((?!_next/static|_next/image|favicon.ico|(?:brand/|og/|team/)?[A-Za-z0-9._-]+\\.(?:png|jpe?g|gif|svg|ico|webp|avif|txt|xml|webmanifest)$).*)',
  ],
}
