import { LoginForm } from '@/components/ui/LoginForm'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Sign In',
}

const AUTH_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    'This email is already registered. Sign in with your password, or use the same method you used originally.',
  OAuthSignin: 'Could not start Google sign-in. Please try again.',
  OAuthCallback: 'Google sign-in failed. Please try again.',
  Callback: 'Sign-in failed. Please try again.',
  Default: 'Something went wrong. Please try again.',
}

type Props = { searchParams: Promise<{ callbackUrl?: string; error?: string }> }

export default async function LoginPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams
  const errorMessage = error ? (AUTH_ERRORS[error] ?? AUTH_ERRORS.Default) : undefined

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

        <LoginForm callbackUrl={callbackUrl ?? '/'} initialError={errorMessage} />

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
