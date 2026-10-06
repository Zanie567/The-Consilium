import { escapeHtml } from '@/lib/escapeHtml'
import { metadataText, safeContentUrl, safeDimension } from '@/lib/richMetadata'
import type { RichContentAttribute } from '@/lib/richContent'

/** Escaped structured metadata, also supported for legacy image nodes. */
export function renderArticleFigure(
  attrs: Record<string, RichContentAttribute> | undefined,
  legacyImage = false
): string {
  const src = escapeHtml(String(attrs?.src ?? ''))
  const alt = escapeHtml(attrs?.decorative === true ? '' : metadataText(attrs?.alt))
  const dimension = (name: string) => {
    const n = safeDimension(attrs?.[name])
    return n ? ` ${name}="${n}"` : ''
  }
  const layout = ['wide', 'centered'].includes(String(attrs?.layout))
    ? ` figure-${attrs?.layout}`
    : ''
  let html = `<figure class="article-figure${layout}"><img src="${src}" alt="${alt}"${dimension('width')}${dimension('height')} />`
  if (!legacyImage) {
    const caption = metadataText(attrs?.caption)
    const credit = metadataText(attrs?.credit)
    const source = metadataText(attrs?.source)
    const url = safeContentUrl(attrs?.sourceUrl)
    const note = metadataText(attrs?.note)
    if (caption) html += `<figcaption class="caption">${escapeHtml(caption)}</figcaption>`
    if (source || url)
      html += `<p class="figure-source">Source: ${url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(source || url)}</a>` : escapeHtml(source)}</p>`
    if (credit) html += `<p class="image-credit">Credit: ${escapeHtml(credit)}</p>`
    if (note) html += `<p class="figure-note">Note: ${escapeHtml(note)}</p>`
  }
  return html + '</figure>'
}
