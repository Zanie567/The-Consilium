/**
 * Validation for a user-supplied profile image URL.
 *
 * A user may change their own avatar, but they may NOT point it at an arbitrary
 * address. The stored value is rendered on public pages (author page, bylines,
 * team card, comments), so an unchecked URL would let any account:
 *   - embed a tracking pixel that reports every reader who loads the page,
 *   - hotlink content we do not control and cannot take down,
 *   - swap the image for something else after any review had passed.
 *
 * So the only accepted values are files in our own avatars bucket — the ones
 * POST /api/upload just wrote, having verified the bytes really are an image.
 */

/** Public prefix of the avatars bucket, derived from the configured Supabase URL. */
function avatarPrefix(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '')
  if (!base) return null
  return `${base}/storage/v1/object/public/avatars/`
}

export type AvatarUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string }

/**
 * Normalises and validates an avatar URL submitted by a user.
 *
 * An empty string clears the avatar (`null`). Anything else must be an https URL
 * inside our avatars bucket.
 */
export function validateAvatarUrl(value: string): AvatarUrlResult {
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, url: null }

  const prefix = avatarPrefix()
  if (!prefix) {
    return { ok: false, error: 'Image storage is not configured on this server.' }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'That is not a valid image URL.' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Profile images must be served over https.' }
  }

  // Compare against the full public prefix rather than just the hostname: another
  // bucket on the same Supabase project is still not a valid avatar location.
  if (!trimmed.startsWith(prefix)) {
    return {
      ok: false,
      error: 'Profile images must be uploaded here rather than linked from another site.',
    }
  }

  // Reject traversal or a bare prefix with no file after it.
  const path = trimmed.slice(prefix.length)
  if (path === '' || path.includes('..')) {
    return { ok: false, error: 'That is not a valid image URL.' }
  }

  return { ok: true, url: trimmed }
}
