/** Shared browser/server URL policy for figures, tables and clipboard links. */
export function safeContentUrl(value: unknown, allowLink = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const url = value.trim()
  if (!url || url.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(url)) return undefined
  if (url.startsWith('/') && !url.startsWith('//')) return url
  if (allowLink && url.startsWith('#')) return url
  try {
    const parsed = new URL(url)
    if (
      !parsed.username &&
      !parsed.password &&
      (['http:', 'https:'].includes(parsed.protocol) ||
        (allowLink && parsed.protocol === 'mailto:'))
    )
      return url
  } catch {
    /* Unsupported URLs degrade to unlinked text. */
  }
  return undefined
}
export function metadataText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : ''
}
export function safeDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 30000
    ? value
    : undefined
}

/** Legacy credits may already include their label; preserve it exactly once. */
export function creditLabel(value: unknown): string {
  const credit = metadataText(value)
  return !credit || /^credit:/i.test(credit) ? credit : `Credit: ${credit}`
}
