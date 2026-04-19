import { ResetPasswordForm } from '@/components/ui/ResetPasswordForm'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Reset Password',
  robots: { index: false, follow: false },
}

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="inline-block text-3xl font-bold text-gold tracking-widest uppercase mb-2 hover:opacity-85 transition-opacity"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            The Consilium
          </Link>
          <p className="text-cream/50 text-xs tracking-widest uppercase">Set new password</p>
        </div>
        {token ? (
          <ResetPasswordForm token={token} apiPath="/api/auth/forgot-password" />
        ) : (
          <div className="text-center">
            <p className="text-cream/60 text-sm mb-4">Invalid or missing reset link.</p>
            <Link href="/forgot-password" className="text-gold text-sm hover:underline">
              Request a new one
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
