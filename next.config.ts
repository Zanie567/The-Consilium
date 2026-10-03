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

// Test-only escape hatch so the E2E suite can render images from a LOCAL storage
// server through the real /_next/image pipeline. Needs an explicit switch AND a
// loopback storage URL, so it cannot be enabled by accident or for a real host.
const localStorage = (() => {
  if (process.env.NEXT_IMAGE_ALLOW_LOCAL_STORAGE !== '1') return null
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? url : null
  } catch {
    return null
  }
})()

const nextConfig: NextConfig = {
  // The isolated E2E stack builds into its own directory so a build made with
  // production env values (which Next inlines for NEXT_PUBLIC_*) can never be
  // served by the test launcher, and the test build never clobbers `next dev`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  images: {
    dangerouslyAllowLocalIP: localStorage !== null,
    // Restrict server-side image fetches to Supabase Storage (where uploads live)
    // instead of any https host, closing the /_next/image SSRF + optimizer-DoS
    // surface. If cover images are ever served from another host, add it here.
    // Allowlist of hosts the /_next/image optimizer may fetch from. Keep this in
    // sync with the image hosts editors actually use for cover images and in-body
    // figures — a host NOT listed here returns 400 from the optimizer and the
    // image silently fails to render. Current usage (verified against the live DB):
    //   *.supabase.co            — uploaded cover/figure images (Supabase Storage)
    //   images.unsplash.com      — externally-sourced cover/figure images
    //   lh3.googleusercontent.com — Google OAuth profile avatars
    // If an editor needs a new external host, add it here (a specific hostname,
    // never '**', which would re-open the optimizer SSRF/DoS surface).
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      ...(localStorage
        ? [{ protocol: 'http' as const, hostname: localStorage.hostname, port: localStorage.port }]
        : []),
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
