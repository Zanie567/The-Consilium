/**
 * One-to-one messages a person asks for (confirm my sign-up, send me my preferences link). They go through
 * the transactional sender (src/lib/email.ts sendEmail), never through the marketing provider, and never
 * contain newsletter content.
 */
import { escapeHtml as esc } from '@/lib/escapeHtml'

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#faf8f3;color:#1a2744;font-family:Georgia,'Times New Roman',serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:3px solid #c9a227">
<tr><td style="padding:28px 32px 8px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#8a6d12;font-family:Arial,Helvetica,sans-serif;font-weight:bold">The Consilium</td></tr>
<tr><td style="padding:0 32px 28px;font-size:16px;line-height:1.6">${body}</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#5b6475;font-family:Arial,Helvetica,sans-serif">The Consilium, the publication of the University of Edinburgh Economics Society. You are receiving this one message because someone entered this address on theconsilium.co.uk.</p>
</td></tr></table></body></html>`
}

function button(href: string, label: string): string {
  return `<p style="margin:28px 0"><a href="${esc(href)}" style="display:inline-block;background:#1a2744;color:#c9a227;text-decoration:none;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase">${esc(label)}</a></p>
<p style="font-size:13px;color:#5b6475;word-break:break-all">If the button does not work, copy this link into your browser:<br>${esc(href)}</p>`
}

export function confirmSubscriptionEmail(confirmUrl: string, wantsAlerts: boolean) {
  const alerts = wantsAlerts
    ? '<p>You also asked for occasional special-article alerts. You can change either choice at any time.</p>'
    : ''
  return {
    subject: 'Confirm your subscription to The Consilium',
    html: shell(
      'Confirm your subscription',
      `<h1 style="font-size:24px;line-height:1.3;margin:12px 0 16px;font-weight:bold">Please confirm your subscription</h1>
<p>Someone (we hope you) asked to receive The Consilium's weekly edition at this address. Nothing will be sent until you confirm.</p>
${alerts}${button(confirmUrl, 'Confirm subscription')}
<p style="font-size:14px;color:#5b6475">The link works once and expires in 48 hours. If you did not ask for this, ignore this email and you will not hear from us again.</p>`,
    ),
  }
}

export function manageLinkEmail(manageUrl: string) {
  return {
    subject: 'Your newsletter preferences: The Consilium',
    html: shell(
      'Manage your newsletter preferences',
      `<h1 style="font-size:24px;line-height:1.3;margin:12px 0 16px;font-weight:bold">Manage your newsletter preferences</h1>
<p>Use this link to choose what you receive from The Consilium, or to unsubscribe.</p>
${button(manageUrl, 'Open my preferences')}
<p style="font-size:14px;color:#5b6475">The link is personal and expires in 14 days. If you did not ask for it, you can ignore this email; nothing has changed.</p>`,
    ),
  }
}
