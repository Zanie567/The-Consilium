import { LoginForm } from '@/components/ui/LoginForm'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Editorial Access | The Consilium',
  robots: { index: false, follow: false },
}

export default function EditorialLoginPage() {
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
          <p className="text-cream/50 text-xs tracking-widest uppercase">
            Editorial Portal
          </p>
        </div>

        <LoginForm redirectTo="/editorial" />
      </div>
    </div>
  )
}
