import { ResetPasswordForm } from './ResetPasswordForm'
import type { Metadata } from 'next'
import { normaliseSearchText, type SearchParamValue } from '@/lib/searchText'

export const metadata: Metadata = {
  title: 'Reset Password | The Consilium',
  robots: { index: false, follow: false },
}

interface Props {
  searchParams: Promise<{ token?: SearchParamValue }>
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const token = normaliseSearchText((await searchParams).token, 128)

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold text-gold tracking-widest uppercase mb-2"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            The Consilium
          </h1>
          <p className="text-cream/40 text-xs tracking-widest uppercase">Reset Password</p>
        </div>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="text-cream/60 text-sm text-center">Invalid or missing reset link.</p>
        )}
      </div>
    </div>
  )
}
