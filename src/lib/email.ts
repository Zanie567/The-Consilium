import { Resend } from 'resend'
import { SITE_URL, CONTACT_EMAIL } from '@/lib/constants'
import { escapeHtml as esc } from '@/lib/escapeHtml'

const FROM = 'The Consilium <noreply@theconsilium.co.uk>'

/**
 * Resolves true only when the message was handed to the transport. It resolves
 * false (after logging) when sending is not configured or the provider rejects
 * it, so callers that care can react; the Resend SDK reports failures through
 * `{ error }` rather than throwing.
 */
export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string
  subject: string
  html: string
  replyTo?: string
}): Promise<boolean> {
  // Test isolation: with EMAIL_TRANSPORT=capture nothing is ever sent. The message
  // is appended (as one JSON line) to EMAIL_CAPTURE_FILE so tests can assert what
  // would have gone out. Checked before RESEND_API_KEY so a real key in the
  // environment cannot override it.
  if (process.env.EMAIL_TRANSPORT === 'capture') {
    const file = process.env.EMAIL_CAPTURE_FILE
    if (!file) {
      console.error('[email] EMAIL_TRANSPORT=capture requires EMAIL_CAPTURE_FILE - email dropped')
      return false
    }
    const { appendFile } = await import('node:fs/promises')
    await appendFile(
      file,
      JSON.stringify({ to, subject, html, ...(replyTo ? { replyTo } : {}), at: new Date().toISOString() }) + '\n',
    )
    return true
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set - email not sent to', to)
    return false
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, ...(replyTo ? { replyTo } : {}) })
    if (error) {
      console.error('[email] Resend rejected the message:', error)
      return false
    }
    return true
  } catch (err) {
    console.error('[email] Failed to send:', err)
    return false
  }
}

// Fixed labels for the form's subject dropdown. The visitor's own subject text is
// never used in the email subject; anything unrecognised falls back to "Other".
const CONTACT_SUBJECT_LABELS: Record<string, string> = {
  writing: 'Write for The Consilium',
  story: 'Story tip or idea',
  collaboration: 'Collaboration enquiry',
  feedback: 'Feedback',
  other: 'Other',
}

export function contactMessageEmail(input: {
  name: string
  email: string
  subject: string
  message: string
}) {
  const label = CONTACT_SUBJECT_LABELS[input.subject] ?? CONTACT_SUBJECT_LABELS.other
  return {
    subject: `Contact form: ${label}`,
    html: `
      <p>New message from the contact form.</p>
      <p><strong>Name:</strong> ${esc(input.name)}<br>
      <strong>Email:</strong> ${esc(input.email)}<br>
      <strong>Subject:</strong> ${esc(input.subject)}</p>
      <blockquote style="border-left:3px solid #c9a227;padding:8px 16px;margin:16px 0;color:#555">${esc(input.message).replace(/\r?\n/g, '<br>')}</blockquote>
      <p>Replying to this email goes to the sender.</p>
    `,
  }
}

export function articleSubmittedEmail(writerName: string, articleTitle: string, articleId: string) {
  return {
    subject: `New article pending review: "${articleTitle}"`,
    html: `
      <p>Hi,</p>
      <p><strong>${esc(writerName)}</strong> has submitted an article for review:</p>
      <p><strong>${esc(articleTitle)}</strong></p>
      <p><a href="${process.env.NEXTAUTH_URL}/editorial/review/${articleId}">Review it in the editorial dashboard →</a></p>
      <p>The Consilium</p>
    `,
  }
}

export function articleReturnedEmail(articleTitle: string, editorNote: string, articleId: string) {
  return {
    subject: `Your article has been returned: "${articleTitle}"`,
    html: `
      <p>Hi,</p>
      <p>Your article <strong>"${esc(articleTitle)}"</strong> has been returned to you with feedback:</p>
      <blockquote style="border-left:3px solid #c9a227;padding:8px 16px;margin:16px 0;color:#555">${esc(editorNote)}</blockquote>
      <p><a href="${process.env.NEXTAUTH_URL}/editorial/articles/${articleId}/edit">Open your article →</a></p>
      <p>The Consilium</p>
    `,
  }
}

export function articlePublishedEmail(articleTitle: string, articleSlug: string) {
  return {
    subject: `Your article is live: "${articleTitle}"`,
    html: `
      <p>Congratulations!</p>
      <p>Your article <strong>"${esc(articleTitle)}"</strong> has been published.</p>
      <p><a href="${process.env.NEXTAUTH_URL}/articles/${articleSlug}">Read it live →</a></p>
      <p>The Consilium</p>
    `,
  }
}

export function passwordResetEmail(resetUrl: string) {
  return {
    subject: 'Reset your editorial password',
    html: `
      <p>Hi,</p>
      <p>A password reset was requested for your editorial account.</p>
      <p><a href="${resetUrl}">Reset your password →</a></p>
      <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
      <p>The Consilium</p>
    `,
  }
}

export function userWarningEmail(userName: string | null, reason: string) {
  return {
    subject: 'A note about your Consilium account',
    html: `
      <p>Hi${userName ? ` ${esc(userName)}` : ''},</p>
      <p>Your account on The Consilium has received a warning from our moderation team.</p>
      <blockquote style="border-left:3px solid #c9a227;padding:8px 16px;margin:16px 0;color:#555">${esc(reason)}</blockquote>
      <p>Please review our community guidelines to ensure your activity remains within our standards. Repeated violations may result in account suspension.</p>
      <p>If you believe this warning was issued in error, please contact our editorial team.</p>
      <p>The Consilium</p>
    `,
  }
}

export function userBannedEmail(userName: string | null, reason: string) {
  return {
    subject: 'Your Consilium account has been suspended',
    html: `
      <p>Hi${userName ? ` ${esc(userName)}` : ''},</p>
      <p>Your account on The Consilium has been suspended.</p>
      <blockquote style="border-left:3px solid #e53e3e;padding:8px 16px;margin:16px 0;color:#555">${esc(reason)}</blockquote>
      <p>If you believe this suspension was issued in error, please contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> to appeal.</p>
      <p>The Consilium</p>
    `,
  }
}

export function userUnbannedEmail(userName: string | null) {
  return {
    subject: 'Your Consilium account has been reinstated',
    html: `
      <p>Hi${userName ? ` ${esc(userName)}` : ''},</p>
      <p>Your account on The Consilium has been reinstated. You can sign in as normal.</p>
      <p>Thank you for your patience. Please continue to follow our community guidelines.</p>
      <p>The Consilium</p>
    `,
  }
}

export function roleChangedEmail(userName: string | null, newRole: string, promoted: boolean) {
  const roleDescriptions: Record<string, string> = {
    WRITER: 'submit articles for editorial review and publish content on The Consilium',
    EDITOR: 'review and publish articles, manage writers, and moderate content',
    GROWTH: 'view audience analytics and manage growth workflows',
    ADMIN: 'access the full editorial dashboard with all admin controls',
    READER: 'read and comment on articles',
  }
  const description = roleDescriptions[newRole] ?? 'access The Consilium'
  const normalised = newRole.charAt(0) + newRole.slice(1).toLowerCase()

  return {
    subject: promoted
      ? `You have been granted ${normalised} access on The Consilium`
      : `Your Consilium account role has been updated`,
    html: `
      <p>Hi${userName ? ` ${esc(userName)}` : ''},</p>
      ${promoted
        ? `<p>You have been granted <strong>${normalised}</strong> access on The Consilium. You can now ${description}.</p>`
        : `<p>Your role on The Consilium has been updated to <strong>${normalised}</strong>.</p>`
      }
      <p>The change applies straight away: reload the page and you're in. You don't need to sign in again.</p>
      ${['WRITER', 'EDITOR', 'GROWTH'].includes(newRole)
        ? `<p>You can now create your public Meet the Team profile from the editorial dashboard (Team Profile in the menu).</p>`
        : ''}
      <p><a href="${process.env.NEXTAUTH_URL}/editorial">Go to the editorial dashboard →</a></p>
      <p>The Consilium</p>
    `,
  }
}

export function commentFlaggedEmail(
  articleTitle: string,
  articleId: string,
  commentExcerpt: string,
  flagReason: string,
) {
  const base = process.env.NEXTAUTH_URL ?? SITE_URL
  return {
    subject: `Comment flagged for review on "${articleTitle}"`,
    html: `
      <p>Hi,</p>
      <p>A comment was flagged by the content filter on the article <strong>"${esc(articleTitle)}"</strong>.</p>
      <blockquote style="border-left:3px solid #c9a227;padding:8px 16px;margin:16px 0;color:#555;font-style:italic">
        ${esc(commentExcerpt.slice(0, 200))}${commentExcerpt.length > 200 ? '…' : ''}
      </blockquote>
      <p><strong>Flag reason:</strong> ${esc(flagReason)}</p>
      <p><a href="${base}/editorial/comments">Review in the moderation dashboard →</a></p>
      <p>The Consilium</p>
    `,
  }
}

export function verifyEmailEmail(userName: string | null, url: string) {
  return {
    subject: 'Confirm your email: The Consilium',
    html: `
      <p>Hi${userName ? ` ${esc(userName)}` : ''},</p>
      <p>Confirm that this is your email address. If an administrator has already given this address access to The Consilium, confirming it is what switches that access on.</p>
      <p><a href="${esc(url)}">Confirm my email →</a></p>
      <p>The link works once and expires in 24 hours. If you didn't ask for this, you can ignore this message.</p>
      <p>The Consilium</p>
    `,
  }
}

export function memberInvitedEmail(displayName: string | null, role: string) {
  const base = process.env.NEXTAUTH_URL ?? SITE_URL
  const label = role.charAt(0) + role.slice(1).toLowerCase()
  return {
    subject: `You've been added to The Consilium as ${label}`,
    html: `
      <p>Hi${displayName ? ` ${esc(displayName)}` : ''},</p>
      <p>You've been given <strong>${esc(label)}</strong> access on The Consilium.</p>
      <p>To use it, create an account (or sign in) with <strong>this email address</strong>. Google sign-in works too, as long as it is the same address. Your access switches on the first time you sign in, and you'll find a Team Profile page to add your photo and description for the Meet the Team page.</p>
      <p><a href="${esc(base)}/signup">Create your account →</a></p>
      <p>The Consilium</p>
    `,
  }
}
