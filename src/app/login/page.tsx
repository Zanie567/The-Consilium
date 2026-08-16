import { LoginForm } from '@/components/ui/LoginForm'
import { safeCallbackPath } from '@/lib/safeRedirect'
import { firstParam, type SearchParamValue } from '@/lib/searchText'
import type { Metadata } from 'next'
import { NOINDEX_ROBOTS } from '@/lib/seo'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Sign In',
  robots: NOINDEX_ROBOTS,
}

const AUTH_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    'This email is already registered. Sign in with your password, or use the same method you used originally.',
  OAuthSignin: 'Could not start Google sign-in. Please try again.',
  OAuthCallback: 'Google sign-in failed. Please try again.',
  Callback: 'Sign-in failed. Please try again.',
  Default: 'Something went wrong. Please try again.',
}

type Props = {
  searchParams: Promise<{ callbackUrl?: SearchParamValue; error?: SearchParamValue }>
}

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams
  // Validated here, on the server, so the form only ever receives a path on
  // this site — it navigates with window.location.replace() itself rather
  // than letting NextAuth's redirect callback vet the destination.
  const callbackUrl = safeCallbackPath(params.callbackUrl)
  const error = firstParam(params.error)
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
          <p className="text-cream/50 text-xs tracking-widest uppercase">Sign in to your account</p>
        </div>

        <LoginForm callbackUrl={callbackUrl} initialError={errorMessage} />

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
