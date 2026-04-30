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
