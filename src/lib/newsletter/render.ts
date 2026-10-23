/**
 * Newsletter email markup (HTML + plain text). Table layout and inline styles for email clients; every
 * piece of article text is escaped; links are only the canonical ones from the snapshot. The footer carries
 * Resend's per-recipient unsubscribe placeholder, which Resend replaces (and uses for List-Unsubscribe).
 */
import { escapeHtml as esc } from '@/lib/escapeHtml'
import { newsletterSiteUrl } from './config'
import type { EditionItem } from './edition'

export const UNSUBSCRIBE_PLACEHOLDER = '{{{RESEND_UNSUBSCRIBE_URL}}}'

export interface RenderInput {
  kind: 'WEEKLY' | 'ALERT'
  subject: string
  previewText: string | null
  intro: string | null
  heading: string
  items: EditionItem[]
}

const NAVY = '#1a2744'
const GOLD = '#c9a227'
const GOLD_TEXT = '#7a5f0e' // gold darkened to 4.5:1+ on white
const CREAM = '#faf8f3'
const MUTED = '#4a5366'

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function itemHtml(item: EditionItem, index: number, lead: boolean): string {
  const image = item.imageUrl
    ? `<tr><td style="padding:0 0 16px"><a href="${esc(item.url)}"><img src="${esc(item.imageUrl)}" alt="${esc(item.imageAlt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0"></a></td></tr>`
    : ''
  const kicker = item.category ? `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${GOLD_TEXT};font-weight:bold">${esc(item.category)}</p>` : ''
  const summary = item.summary ? `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#2b3345">${esc(item.summary)}</p>` : ''
  return `<tr><td style="padding:${index === 0 ? '8px' : '28px'} 0 0;${index === 0 ? '' : 'border-top:1px solid #e6e1d3;'}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lead ? image : ''}
<tr><td>${kicker}<h2 class="${lead ? 'c-lead' : 'c-title'}" style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-size:${lead ? 26 : 21}px;line-height:1.25;color:${NAVY}"><a href="${esc(item.url)}" style="color:${NAVY};text-decoration:none">${esc(item.title)}</a></h2>
<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED}">By ${esc(item.author)}</p>
${lead ? '' : image}${summary}<p style="margin:0"><a href="${esc(item.url)}" aria-label="Read ${esc(item.title)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${GOLD_TEXT};text-decoration:underline">Read the article</a></p></td></tr>
</table></td></tr>`
}

/** "In this edition": the titles, linked, when there is more than one article. */
function contents(items: EditionItem[]): string {
  if (items.length < 2) return ''
  const rows = items
    .map((item) => `<li style="margin:0 0 6px"><a href="${esc(item.url)}" style="color:${NAVY};text-decoration:none;font-weight:bold">${esc(item.title)}</a> <span style="color:${MUTED};font-family:Arial,Helvetica,sans-serif;font-size:13px">by ${esc(item.author)}</span></li>`)
    .join('')
  return `<div style="margin:0 0 20px;padding:16px 18px;background:${CREAM};border:1px solid #e6e1d3"><p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${GOLD_TEXT};font-weight:bold">In this edition</p><ol style="margin:0;padding:0 0 0 20px;font-size:15px;line-height:1.5">${rows}</ol></div>`
}

export function renderNewsletterHtml(input: RenderInput, options: { unsubscribeUrl?: string } = {}): string {
  const site = newsletterSiteUrl()
  const unsubscribe = options.unsubscribeUrl ?? UNSUBSCRIBE_PLACEHOLDER
  const reason =
    input.kind === 'WEEKLY'
      ? "You are receiving this because you subscribed to The Consilium's weekly edition and confirmed your address."
      : 'You are receiving this because you opted in to occasional special-article alerts from The Consilium.'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(input.subject)}</title>
<style>
  /* Phones: clients that support media queries get tighter gutters and smaller headings; others get the fluid table. */
  @media only screen and (max-width: 620px) {
    .c-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .c-masthead { font-size: 26px !important; }
    .c-lead { font-size: 22px !important; }
    .c-title { font-size: 19px !important; }
    .c-body { font-size: 15px !important; }
  }
  a { color: ${NAVY}; }
</style></head>
<body style="margin:0;padding:0;background:${CREAM};color:${NAVY}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(input.previewText ?? '')}&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td class="c-pad" style="background:${NAVY};padding:26px 32px;border-bottom:3px solid ${GOLD}">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.35em;text-transform:uppercase;color:${GOLD};font-weight:bold">${input.kind === 'WEEKLY' ? 'The Weekly Edition' : 'Special Article'}</p>
<p class="c-masthead" style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;color:${CREAM};font-weight:bold">The Consilium</p>
<p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#d9d4c5">${esc(input.heading)}</p>
</td></tr>
<tr><td class="c-pad c-body" style="background:#ffffff;padding:28px 32px 32px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#2b3345">
${input.intro ? `<div style="margin:0 0 24px;padding:0 0 0 16px;border-left:3px solid ${GOLD}"><p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${GOLD_TEXT};font-weight:bold">From the editors</p>${paragraphs(input.intro)}</div>` : ''}
${contents(input.items)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${input.items.map((item, i) => itemHtml(item, i, i === 0)).join('')}</table>
</td></tr>
<tr><td class="c-pad" style="padding:24px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED}">
<p style="margin:0 0 8px">${reason}</p>
<p style="margin:0 0 8px"><a href="${esc(unsubscribe)}" style="color:${NAVY};font-weight:bold">Unsubscribe or change topics</a> &nbsp;·&nbsp; <a href="${esc(site)}/newsletter/manage" style="color:${NAVY}">Email me a link to my preferences</a> &nbsp;·&nbsp; <a href="${esc(site)}/privacy" style="color:${NAVY}">Privacy</a></p>
<p style="margin:0">The Consilium, the publication of the University of Edinburgh Economics Society, Edinburgh, United Kingdom.</p>
</td></tr></table></td></tr></table></body></html>`
}

export function renderNewsletterText(input: RenderInput, options: { unsubscribeUrl?: string } = {}): string {
  const site = newsletterSiteUrl()
  const lines = [`THE CONSILIUM: ${input.kind === 'WEEKLY' ? 'THE WEEKLY EDITION' : 'SPECIAL ARTICLE'}`, input.heading, '']
  if (input.intro) lines.push('FROM THE EDITORS', input.intro.trim(), '')
  if (input.items.length > 1) lines.push('IN THIS EDITION', ...input.items.map((item, i) => `${i + 1}. ${item.title} (${item.author})`), '')
  for (const item of input.items) {
    lines.push(item.title, `By ${item.author}`)
    if (item.summary) lines.push(item.summary)
    lines.push(`Read: ${item.url}`, '')
  }
  lines.push('—', `Unsubscribe or change topics: ${options.unsubscribeUrl ?? UNSUBSCRIBE_PLACEHOLDER}`, `Email me a link to my preferences: ${site}/newsletter/manage`, `Privacy: ${site}/privacy`)
  return lines.join('\n')
}
