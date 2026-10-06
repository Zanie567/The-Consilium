import { escapeHtml } from '@/lib/escapeHtml'
import { metadataText, safeContentUrl } from '@/lib/richMetadata'
import type { TiptapNode } from '@/lib/richContent'

/** Native table JSON stays native; cells reuse the normal inline renderer. */
export function renderArticleTable(node: TiptapNode, render: (node: TiptapNode) => string): string {
  const rows = (node.content ?? []).filter((row) => row.type === 'tableRow').slice(0, 500)
  if (
    !rows.length ||
    !rows.some((row) =>
      row.content?.some((cell) => ['tableHeader', 'tableCell'].includes(cell.type))
    )
  )
    return ''
  const caption = metadataText(node.attrs?.caption)
  let html = '<figure class="article-table">'
  if (caption) html += `<figcaption>${escapeHtml(caption)}</figcaption>`
  html +=
    '<div class="table-scroll" role="region" aria-label="Article table" tabindex="0"><table><tbody>'
  for (const row of rows) {
    html += '<tr>'
    for (const cell of (row.content ?? [])
      .filter((c) => ['tableHeader', 'tableCell'].includes(c.type))
      .slice(0, 100)) {
      const tag = cell.type === 'tableHeader' ? 'th' : 'td'
      const span = (key: string) => {
        const n = Number(cell.attrs?.[key])
        return Number.isInteger(n) && n > 1 && n <= 100 ? ` ${key}="${n}"` : ''
      }
      html += `<${tag}${tag === 'th' ? ' scope="col"' : ''}${span('colspan')}${span('rowspan')}>${(cell.content ?? []).map(render).join('')}</${tag}>`
    }
    html += '</tr>'
  }
  html += '</tbody></table></div>'
  const source = metadataText(node.attrs?.source)
  const url = safeContentUrl(node.attrs?.sourceUrl)
  const note = metadataText(node.attrs?.note)
  if (source || url)
    html += `<p class="table-source">Source: ${url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(source || url)}</a>` : escapeHtml(source)}</p>`
  if (note) html += `<p class="table-note">Note: ${escapeHtml(note)}</p>`
  return html + '</figure>'
}
