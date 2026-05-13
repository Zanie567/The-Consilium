'use client'

import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { SystemMessagePage } from '@/components/ui/SystemMessagePage'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Only log errors that have a digest, those are server-side Next.js errors
    // worth surfacing to an error reporting service. Client-only errors (no digest)
    // tend to be transient UI issues and do not need to be logged.
    if (error.digest) {
      console.error('[GlobalError]', error.digest, error.message)
    }
  }, [error])

  return (
    <SystemMessagePage
      eyebrow="Something went wrong"
      title="Unexpected Error"
      statusLabel="!"
      message={
        <>
          Something went wrong on our end. Try again, or head back to the homepage.
          {error.digest && (
            <span className="mt-2 block font-mono text-xs text-[var(--fg-faint)]">
              Reference: {error.digest}
            </span>
          )}
        </>
      }
      action={
        <button
          onClick={reset}
          className="inline-flex min-h-12 items-center justify-center gap-2 bg-navy px-7 py-3 text-xs font-bold uppercase tracking-widest text-gold transition-colors duration-200 hover:bg-navy/85 dark:border dark:border-gold/35"
        >
          <RotateCcw size={15} aria-hidden="true" />
          Try Again
        </button>
      }
    />
  )
}
