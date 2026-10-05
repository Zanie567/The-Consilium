/**
 * Display titles: the public-facing labels a person holds ("Deputy Editor-in-Chief",
 * "Writer"). They are labels only. Nothing grants access from them: permissions come
 * from the `Role` enum and nowhere else.
 *
 * The allowed list is closed on purpose, so nobody can invent a misleading title.
 * Leadership and Wider Team are masthead tiers, not titles, and are excluded.
 * Keep this list in step with `users_display_titles_valid` in
 * supabase/migrations/20261005_user_display_titles.sql, which enforces it again
 * in the database.
 *
 * Client-safe: no server imports.
 */

export const ALLOWED_DISPLAY_TITLES = [
  'Editor-in-Chief',
  'Deputy Editor-in-Chief',
  'Editor',
  'Writer',
  'Senior Editor',
  'Junior Editor',
  'Growth & Communications',
] as const

export type DisplayTitle = (typeof ALLOWED_DISPLAY_TITLES)[number]

export const MAX_DISPLAY_TITLES = 4

const ALLOWED = new Set<string>(ALLOWED_DISPLAY_TITLES)

export type DisplayTitlesResult =
  | { ok: true; titles: DisplayTitle[] }
  | { ok: false; error: string }

/** Validates a submitted titles value: an array of allowed, distinct titles, at most four. */
export function validateDisplayTitles(value: unknown): DisplayTitlesResult {
  if (!Array.isArray(value)) return { ok: false, error: 'displayTitles must be an array.' }
  if (value.length > MAX_DISPLAY_TITLES) {
    return { ok: false, error: `You can hold at most ${MAX_DISPLAY_TITLES} titles.` }
  }
  for (const item of value) {
    if (typeof item !== 'string' || !ALLOWED.has(item)) {
      return { ok: false, error: 'One of the titles is not an allowed title.' }
    }
  }
  if (new Set(value).size !== value.length) {
    return { ok: false, error: 'Titles must not repeat.' }
  }
  return { ok: true, titles: value as DisplayTitle[] }
}

/** Defensive read of a stored value: keeps only allowed, distinct entries, in order. */
export function readDisplayTitles(value: unknown): DisplayTitle[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: DisplayTitle[] = []
  for (const item of value) {
    if (typeof item === 'string' && ALLOWED.has(item) && !seen.has(item)) {
      seen.add(item)
      out.push(item as DisplayTitle)
    }
  }
  return out.slice(0, MAX_DISPLAY_TITLES)
}

// ADMIN and READER are deliberately absent. Administrator is a permission, not a
// title, and naming it on a public page would advertise which accounts hold it;
// a reader has nothing to show. Both fall through to the caller's own empty copy.
const ROLE_LABELS: Record<string, string> = {
  EDITOR: 'Editor',
  WRITER: 'Writer',
  GROWTH: 'Growth & Communications',
}

/** Public label for a permission role, used only as the last fallback. */
export function permissionRoleLabel(role: string | null | undefined): string | null {
  return (role && ROLE_LABELS[role]) || null
}

/**
 * The public title line. Order of preference:
 *   1. the person's display titles, joined with " · "
 *   2. the team card's title
 *   3. the permission role's label
 * Returns null when there is nothing to show, so callers pick their own empty copy.
 */
export function resolvePublicTitleLabel(input: {
  displayTitles?: unknown
  cardTitle?: string | null
  role?: string | null
}): string | null {
  const titles = readDisplayTitles(input.displayTitles)
  if (titles.length > 0) return titles.join(' · ')
  const card = input.cardTitle?.trim()
  if (card) return card
  return permissionRoleLabel(input.role)
}
