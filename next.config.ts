import type { NextConfig } from 'next'

// 'unsafe-eval' is only required by the dev HMR / React Refresh runtime — it must
// never reach production, where it would let an injected string become executable
// code. 'unsafe-inline' is still required for Next's inline bootstrap, next-themes'
// anti-flash script, and the JSON-LD blocks; migrating to a nonce-based CSP (which
// removes 'unsafe-inline') is the recommended follow-up and needs browser verification.
const scriptSrc =
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'"

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https:",
      "media-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  images: {
    // Restrict server-side image fetches to Supabase Storage (where uploads live)
    // instead of any https host, closing the /_next/image SSRF + optimizer-DoS
    // surface. If cover images are ever served from another host, add it here.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      // Google OAuth profile images (lh3.googleusercontent.com)
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  experimental: {
    viewTransition: true,
  },
  async redirects() {
    return [
      { source: '/news',       destination: '/category/news',      permanent: true },
      { source: '/opinion',    destination: '/category/opinion',   permanent: true },
      { source: '/analysis',   destination: '/category/analysis',  permanent: true },
      { source: '/interviews', destination: '/category/interviews', permanent: true },
      { source: '/debate',     destination: '/opinion-debate',     permanent: true },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
