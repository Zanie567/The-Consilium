import { Resend } from 'resend'
import { createHmac } from 'crypto'

export function unsubscribeUrl(email: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? 'consilium-unsubscribe'
  const token = createHmac('sha256', secret).update(email.toLowerCase()).digest('hex')
  const base = process.env.NEXTAUTH_URL ?? 'https://the-consilium.vercel.app'
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`
}

const FROM = 'The Consilium <noreply@theconsilium.co.uk>'

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — email not sent to', to)
    return
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({ from: FROM, to, subject, html })
  } catch (err) {
    console.error('[email] Failed to send:', err)
  }
}

export function articleSubmittedEmail(writerName: string, articleTitle: string, articleId: string) {
  return {
    subject: `New article pending review: "${articleTitle}"`,
    html: `
      <p>Hi,</p>
      <p><strong>${writerName}</strong> has submitted an article for review:</p>
      <p><strong>${articleTitle}</strong></p>
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
      <p>Your article <strong>"${articleTitle}"</strong> has been returned to you with feedback:</p>
      <blockquote style="border-left:3px solid #c9a227;padding:8px 16px;margin:16px 0;color:#555">${editorNote}</blockquote>
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
      <p>Your article <strong>"${articleTitle}"</strong> has been published.</p>
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

export function commentFlaggedEmail(
  articleTitle: string,
  articleId: string,
  commentExcerpt: string,
  flagReason: string,
) {
  const base = process.env.NEXTAUTH_URL ?? 'https://the-consilium.vercel.app'
  return {
    subject: `Comment flagged for review on "${articleTitle}"`,
    html: `
      <p>Hi,</p>
      <p>A comment was flagged by the content filter on the article <strong>"${articleTitle}"</strong>.</p>
      <blockquote style="border-left:3px solid #c9a227;padding:8px 16px;margin:16px 0;color:#555;font-style:italic">
        ${commentExcerpt.slice(0, 200)}${commentExcerpt.length > 200 ? '…' : ''}
      </blockquote>
      <p><strong>Flag reason:</strong> ${flagReason}</p>
      <p><a href="${base}/editorial/comments">Review in the moderation dashboard →</a></p>
      <p>The Consilium</p>
    `,
  }
}
