import Link from 'next/link'
import type { ReactNode } from 'react'

/** Frame for the public newsletter pages (confirm, preferences, manage, unsubscribe). */
export function NewsletterShell({ eyebrow = 'The Consilium', title, intro, children }: { eyebrow?: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-[70vh] bg-[var(--bg)] px-4 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-lg">
        <div className="h-[2px] bg-gradient-to-r from-transparent via-gold to-transparent opacity-60 mb-10" aria-hidden="true" />
        <p className="text-gold-dark dark:text-gold text-[0.65rem] font-bold uppercase tracking-[0.3em] mb-3">{eyebrow}</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--fg)] leading-tight mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
          {title}
        </h1>
        {intro ? <div className="text-[var(--fg-muted)] text-sm leading-relaxed mb-8">{intro}</div> : null}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-5 sm:p-7">{children}</div>
        <p className="mt-8 text-xs text-[var(--fg-faint)] leading-relaxed">
          Questions about your data? Read our{' '}
          <Link href="/privacy#newsletter" className="text-gold-dark dark:text-gold underline underline-offset-2">
            Privacy Policy
          </Link>
          .{' '}
          <Link href="/" className="text-gold-dark dark:text-gold underline underline-offset-2">
            Back to The Consilium
          </Link>
        </p>
      </div>
    </main>
  )
}

export const primaryButton =
  'inline-flex items-center justify-center gap-2 bg-navy text-gold px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-navy-light disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold dark:bg-gold dark:text-navy dark:hover:bg-gold-light'
export const secondaryButton =
  'inline-flex items-center justify-center gap-2 border border-[var(--border-strong)] text-[var(--fg)] px-5 py-3 text-xs font-bold uppercase tracking-widest hover:border-gold disabled:opacity-60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold'
export const inputClass =
  'w-full bg-[var(--bg)] border border-[var(--border-strong)] text-[var(--fg)] placeholder:text-[var(--fg-faint)] px-4 py-3 text-base sm:text-sm focus:outline-none focus:border-gold transition-colors'
