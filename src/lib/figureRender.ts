import { escapeHtml } from '@/lib/escapeHtml'
import type { RichContentAttribute } from '@/lib/richContent'

/** Figure workstream boundary. Output still passes through articleSanitize.
 * Preserve current output and legacy image nodes; metadata extensions come later.
 */
export function renderArticleFigure(
  attrs: Record<string, RichContentAttribute> | undefined,
  legacyImage = false,
): string {
  const src = escapeHtml(String(attrs?.src ?? ''))
  const alt = escapeHtml(String(attrs?.alt ?? ''))
  let html = `<figure class="article-figure"><img src="${src}" alt="${alt}" />`
  if (!legacyImage) {
    const caption = escapeHtml(String(attrs?.caption ?? ''))
    const credit = escapeHtml(String(attrs?.credit ?? ''))
    if (caption) html += `<figcaption class="caption">${caption}</figcaption>`
    if (credit) html += `<p class="image-credit">${credit}</p>`
  }
  return html + '</figure>'
}
