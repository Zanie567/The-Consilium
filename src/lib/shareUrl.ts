/** Sharing always uses a publication origin, never a preview or localhost. */
export function articleShareUrl(slug: string): string {
  let origin = 'https://theconsilium.co.uk'
  try {
    const candidate = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? origin)
    if (
      candidate.protocol === 'https:' &&
      !candidate.hostname.endsWith('.vercel.app') &&
      candidate.hostname !== 'localhost' &&
      !/^\d+\./.test(candidate.hostname) &&
      !candidate.username &&
      !candidate.password
    )
      origin = candidate.origin
  } catch {
    /* production fallback */
  }
  return `${origin}/articles/${encodeURIComponent(slug)}`
}
