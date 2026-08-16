'use client'

import { useEffect } from 'react'
import Link from 'next/link'

interface ErrorPageProps {
  error: Error & { digest?: string }
  // `unstable_retry` re-fetches and re-renders the boundary's children, unlike
  // `reset`, which re-renders the same already-failed tree without re-fetching.
  // Most errors that reach this page are failed data loads, so retrying without
  // re-fetching would always land back here. Added in Next 16.2.
  unstable_retry: () => void
}

export default function GlobalError({ error, unstable_retry }: ErrorPageProps) {
  useEffect(() => {
    // Only log errors that have a digest, those are server-side Next.js errors
    // worth surfacing to an error reporting service. Client-only errors (no digest)
    // tend to be transient UI issues and do not need to be logged.
    if (error.digest) {
      console.error('[GlobalError]', error.digest, error.message)
    }
  }, [error])

  return (
    <div className="min-h-[70vh] bg-[var(--bg)] flex flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-gold/60 text-[0.65rem] tracking-[0.4em] uppercase mb-4 font-semibold">
        Something went wrong
      </p>

      <h1
        className="text-5xl sm:text-6xl font-bold text-[var(--fg)] mb-4"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Unexpected Error
      </h1>

      <div className="w-12 h-0.5 bg-gold/40 mx-auto mb-6" />

      <p className="text-[var(--fg-muted)] text-base sm:text-lg max-w-md leading-relaxed mb-10">
        Something went wrong on our end. Try refreshing the page, or head back to the homepage.
        {error.digest && (
          <span className="block mt-2 text-[var(--fg-faint)] text-xs font-mono">
            Reference: {error.digest}
          </span>
        )}
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <button
          onClick={() => unstable_retry()}
          className="inline-flex items-center gap-2 bg-navy text-gold border border-gold/40 px-8 py-3 text-xs font-bold uppercase tracking-widest hover:bg-navy/80 transition-colors duration-200"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest hover:opacity-70 transition-opacity duration-200"
        >
          ← Back to Homepage
        </Link>
      </div>
    </div>
  )
}
