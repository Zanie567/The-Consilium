import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { SetupForm } from './SetupForm'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Setup | The Consilium',
  robots: { index: false, follow: false },
}

export default async function SetupPage() {
  // Only accessible if no Admin exists yet
  const adminExists = await prisma.user.findFirst({ where: { role: 'ADMIN' } }).catch(() => null)
  if (adminExists) redirect('/editorial/login')

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
          <p className="text-cream/50 text-xs tracking-widest uppercase">First-Time Setup</p>
          <p className="text-cream/40 text-xs mt-2">Create the Admin account to get started.</p>
        </div>
        <SetupForm />
      </div>
    </div>
  )
}
