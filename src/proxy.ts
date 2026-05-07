import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Ban enforcement ───────────────────────────────────────────────────────
  // Skip for the banned page itself, auth routes, and static assets
  const isBannable =
    !pathname.startsWith('/banned') &&
    !pathname.startsWith('/api/auth') &&
    !pathname.startsWith('/login') &&
    !pathname.startsWith('/_next') &&
    !pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|woff|woff2|ttf)$/)

  if (isBannable) {
    try {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
      if (token?.isBanned && !pathname.startsWith('/api/')) {
        return NextResponse.redirect(new URL('/banned', request.url))
      }
    } catch {
      // If token check fails, let the request through
    }
  }

  // ── CSRF protection for API routes ───────────────────────────────────────
  // NextAuth handles its own CSRF for /api/auth/* - skip those.
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
     * Match all paths except Next.js internals and static files
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
