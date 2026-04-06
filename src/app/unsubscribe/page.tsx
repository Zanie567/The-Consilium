import { createHmac } from 'crypto'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Unsubscribe' }

function verifyToken(email: string, token: string): boolean {
  const secret = process.env.NEXTAUTH_SECRET ?? 'consilium-unsubscribe'
  const expected = createHmac('sha256', secret).update(email.toLowerCase()).digest('hex')
  return expected === token
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>
}) {
  const { email, token } = await searchParams

  if (!email || !token) {
    return <Result success={false} message="Invalid unsubscribe link." />
  }

  if (!verifyToken(email, token)) {
    return <Result success={false} message="This unsubscribe link is not valid or has expired." />
  }

  try {
    await prisma.subscriber.deleteMany({ where: { email: email.toLowerCase() } })
    return <Result success={true} message={`${email} has been removed from our mailing list.`} />
  } catch {
    return <Result success={false} message="Something went wrong. Please try again or contact us." />
  }
}

function Result({ success, message }: { success: boolean; message: string }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="h-[2px] bg-gradient-to-r from-transparent via-gold to-transparent opacity-60 mb-12" />
        <p
          className="text-gold text-[0.65rem] font-bold uppercase tracking-[0.3em] mb-4"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          The Consilium
        </p>
        <h1
          className="text-3xl font-bold text-[var(--fg)] mb-4"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {success ? 'Unsubscribed' : 'Something went wrong'}
        </h1>
        <p className="text-[var(--fg-muted)] text-sm mb-8">{message}</p>
        {success && (
          <p className="text-[var(--fg-faint)] text-xs mb-8">
            You will no longer receive newsletter emails from us. If you change your mind, you can
            subscribe again from the{' '}
            <Link href="/" className="text-gold hover:underline">
              homepage
            </Link>
            .
          </p>
        )}
        {!success && (
          <p className="text-[var(--fg-faint)] text-xs mb-8">
            Please contact us at{' '}
            <a href="mailto:theconsilium.editor@gmail.com" className="text-gold hover:underline">
              theconsilium.editor@gmail.com
            </a>{' '}
            and we will remove you manually.
          </p>
        )}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest hover:gap-3 transition-all duration-200 group"
        >
          <span className="transition-transform duration-200 group-hover:-translate-x-1">&larr;</span>
          Back to Homepage
        </Link>
      </div>
    </div>
  )
}
