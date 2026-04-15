import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function proxy(request: NextRequest) {
  // NextAuth handles its own CSRF for /api/auth/* - skip those.
  if (request.nextUrl.pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // For all other API routes, enforce same-origin on state-changing methods.
  if (!SAFE_METHODS.has(request.method)) {
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
  matcher: '/api/:path*',
}
