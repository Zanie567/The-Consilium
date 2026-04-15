import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Account Suspended | The Consilium',
  robots: { index: false, follow: false },
}

export default function BannedPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>

        <h1
          className="text-3xl font-bold text-[var(--fg)] mb-3"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Account Suspended
        </h1>

        <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-2">
          Your account on The Consilium has been suspended and you are unable to access the site.
        </p>
        <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-8">
          If you believe this is an error or would like to appeal, please contact us at{' '}
          <a
            href="mailto:theconsilium.editor@gmail.com"
            className="text-gold hover:underline"
          >
            theconsilium.editor@gmail.com
          </a>
          .
        </p>

        <div className="flex flex-col gap-3 items-center">
          <Link
            href="/api/auth/signout"
            className="border border-[var(--border)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-6 py-2.5 hover:border-gold/40 hover:text-gold transition-colors"
          >
            Sign Out
          </Link>
          <Link
            href="/"
            className="text-[var(--fg-faint)] text-xs hover:text-gold transition-colors"
          >
            Return to home page
          </Link>
        </div>
      </div>
    </div>
  )
}
