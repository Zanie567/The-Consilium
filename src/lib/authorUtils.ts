import { isAllowedRole, PUBLIC_AUTHOR_PROFILE_ROLES } from './rbac'

/** Returns "The Consilium Editorial Team" for CMS system account in public-facing views */
export function displayAuthorName(name: string | null | undefined): string {
  if (name === 'The Consilium Admin') return 'The Consilium Editorial Team'
  return name ?? ''
}

/** Returns two-letter initials: first letter of first word + first letter of last word.
 *  Single-word names get their first two characters. */
export function getInitials(name: string | null | undefined): string {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return name.slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * The public, shareable page for an account, or null when that account is not meant to have
 * one. This is the only link the profile page offers to share: /profile is the signed-in
 * person's own private page and means something different to whoever opens it.
 */
export function publicAuthorPath(user: { id: string; slug: string | null; role: string }): string | null {
  return isAllowedRole(user.role, PUBLIC_AUTHOR_PROFILE_ROLES) ? `/author/${user.slug ?? user.id}` : null
}
