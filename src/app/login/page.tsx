import { LoginForm } from '@/components/ui/LoginForm'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Sign In',
}

export default function LoginPage() {
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
            Sign in to your account
          </p>
        </div>

        <LoginForm />

        <p className="text-center text-cream/40 text-xs mt-6">
          No account?{' '}
          <Link href="/signup" className="text-gold/80 hover:text-gold transition-colors">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
