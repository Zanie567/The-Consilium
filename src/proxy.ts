import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

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
  if (/^\/api\/editorial\/articles\/[^/]+\/view$/.test(pathname)) return true
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
    return NextResponse.next()
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

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static files.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
