/**
 * Escapes the five HTML-significant characters so a string can be safely
 * interpolated into markup — before wrapping search matches in `<mark>`, building
 * an email body, or emitting stored text through `dangerouslySetInnerHTML`. Use
 * this anywhere untrusted text meets HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
