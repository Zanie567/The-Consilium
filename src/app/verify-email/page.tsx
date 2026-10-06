import type { Metadata } from 'next'
import Link from 'next/link'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'

export const metadata: Metadata = { title: 'Confirm your email', robots: NOINDEX_NOFOLLOW_ROBOTS }
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ token?: string; status?: string }>
}

const MESSAGES: Record<string, { title: string; body: string }> = {
  ok: { title: 'Email confirmed', body: 'Thanks, your email address is confirmed.' },
  activated: {
    title: 'Email confirmed, access activated',
    body: 'Your team access is now active. Sign in again if you were already signed in.',
  },
  invalid: { title: 'This link has expired', body: 'Request a new confirmation email from your profile page.' },
  error: { title: 'Something went wrong', body: 'Please try again in a few minutes.' },
}

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { token, status } = await searchParams
  const message = status ? (MESSAGES[status] ?? MESSAGES.error) : null

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        {message ? (
          <>
            <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{message.title}</h1>
            <p className="mt-3 text-sm text-[var(--fg-muted)]">{message.body}</p>
            <Link href="/login" className="mt-6 inline-block text-sm font-bold uppercase tracking-widest text-gold">Continue</Link>
          </>
        ) : token ? (
          <>
            <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>Confirm your email</h1>
            <p className="mt-3 text-sm text-[var(--fg-muted)]">Press the button to confirm this address.</p>
            <form method="post" action="/api/auth/verify-email" className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="min-h-[44px] bg-navy px-6 text-xs font-bold uppercase tracking-widest text-cream">
                Confirm email
              </button>
            </form>
          </>
        ) : (
          <p className="text-sm text-[var(--fg-muted)]">This confirmation link is incomplete.</p>
        )}
      </div>
    </div>
  )
}
