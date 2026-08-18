import { ForgotPasswordForm } from '@/components/ui/ForgotPasswordForm'
import type { Metadata } from 'next'
import { NOINDEX_ROBOTS } from '@/lib/seo'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Forgot Password',
  robots: NOINDEX_ROBOTS,
}

export default function ForgotPasswordPage() {
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
          <p className="text-cream/50 text-xs tracking-widest uppercase">
            Reset your password
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-center text-cream/40 text-xs mt-6">
          Remembered it?{' '}
          <Link href="/login" className="text-gold/80 hover:text-gold transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
