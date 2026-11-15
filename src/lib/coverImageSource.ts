/**
 * How a stored cover-image value can be shown in a list.
 *
 * `coverImage` is free text: an upload produces a Supabase Storage URL, but an editor can also
 * paste any address. Three things follow from that:
 *
 *   - a host the image optimiser is not allowed to fetch (`images.remotePatterns` in
 *     next.config.ts) answers 400 from /_next/image, so the picture silently breaks. Those are
 *     loaded straight from their own host instead ('direct');
 *   - a value that is not an http(s) URL or a site path can never load, so no request is made
 *     for it ('invalid');
 *   - an article without a cover is a normal state, not an error ('none').
 *
 * Pure and browser-safe, so the same rule runs on the server, in the browser and in unit tests.
 */

/**
 * Hosts the optimiser may fetch from. Must match `images.remotePatterns` in next.config.ts;
 * tests/unit/cover-image-source.test.ts fails if the two lists drift apart. A leading `*.`
 * matches exactly one subdomain label, as it does in Next's own pattern matching.
 */
export const OPTIMISED_IMAGE_HOSTS = ['*.supabase.co', 'images.unsplash.com', 'lh3.googleusercontent.com'] as const

export type CoverImageSource =
  | { kind: 'none' }
  | { kind: 'invalid' }
  /** Served through /_next/image: resized, re-encoded and cached at the CDN. */
  | { kind: 'optimised'; src: string }
  /** Loaded from its own host at its original size. */
  | { kind: 'direct'; src: string }

const MAX_LENGTH = 2048

function hostMatches(hostname: string, pattern: string): boolean {
  if (!pattern.startsWith('*.')) return hostname === pattern
  const suffix = pattern.slice(1) // ".supabase.co"
  if (!hostname.endsWith(suffix)) return false
  const label = hostname.slice(0, -suffix.length)
  return label.length > 0 && !label.includes('.')
}

export function isOptimisedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return OPTIMISED_IMAGE_HOSTS.some((pattern) => hostMatches(host, pattern))
}

export function coverImageSource(value: string | null | undefined): CoverImageSource {
  const src = typeof value === 'string' ? value.trim() : ''
  if (!src) return { kind: 'none' }
  if (src.length > MAX_LENGTH) return { kind: 'invalid' }

  // A file served by this site (for example a legacy /team/*.png). `//host` is a different site.
  if (src.startsWith('/')) {
    return src.startsWith('//') || src.includes('\\') ? { kind: 'invalid' } : { kind: 'optimised', src }
  }

  let url: URL
  try {
    url = new URL(src)
  } catch {
    return { kind: 'invalid' }
  }
  if (url.username || url.password) return { kind: 'invalid' }
  if (url.protocol === 'https:') {
    return isOptimisedImageHost(url.hostname) ? { kind: 'optimised', src } : { kind: 'direct', src }
  }
  // Plain http is what the local storage emulator serves in tests. In production the
  // Content-Security-Policy refuses it, which lands on the same fallback as any failed load.
  if (url.protocol === 'http:') return { kind: 'direct', src }
  return { kind: 'invalid' }
}

/** True when the value is an address a browser could load (it may still fail when requested). */
export function hasDisplayableCover(value: string | null | undefined): boolean {
  const { kind } = coverImageSource(value)
  return kind === 'optimised' || kind === 'direct'
}
