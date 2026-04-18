import { SignUpForm } from '@/components/ui/SignUpForm'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Create Account',
}

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="inline-block text-2xl font-bold text-[var(--fg)] tracking-wider mb-2"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            The Consilium
          </Link>
          <p className="text-[var(--fg-faint)] text-xs tracking-widest uppercase">
            Create an account
          </p>
        </div>

        <SignUpForm />

        <p className="text-center text-[var(--fg-faint)] text-xs mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-gold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
