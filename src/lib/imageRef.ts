/**
 * The image references an ADMINISTRATOR may store as a profile photo: an http(s) URL or a
 * site-relative path (legacy `/team/*.png`). Never script, data or protocol-relative URLs.
 * Members are held to the stricter avatars-bucket rule in avatarUrl.ts.
 */
export type ImageRefResult = { ok: true; value: string | null } | { ok: false; error: string }

export function checkImageRef(value: unknown): ImageRefResult {
  if (value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'Photo must be an image URL.' }
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (trimmed.length > 2048) return { ok: false, error: 'Photo URL is too long.' }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return { ok: true, value: trimmed }
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'https:' || url.protocol === 'http:') return { ok: true, value: trimmed }
  } catch {
    // fall through
  }
  return { ok: false, error: 'Photo must be an http(s) image URL or a path starting with /.' }
}
