import Link from 'next/link'
import { ArrowLeft, Home, Search } from 'lucide-react'
import type { ReactNode } from 'react'

interface SystemMessagePageProps {
  eyebrow: string
  title: string
  message: ReactNode
  statusLabel?: string
  primaryLabel?: string
  showSearchLink?: boolean
  action?: ReactNode
}

export function SystemMessagePage({
  eyebrow,
  title,
  message,
  statusLabel = '404',
  primaryLabel = 'Go to Homepage',
  showSearchLink = true,
  action,
}: SystemMessagePageProps) {
  return (
    <section className="min-h-[calc(100svh-8rem)] bg-[var(--bg)] px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <div className="mb-8 flex h-20 w-20 items-center justify-center border border-gold/30 bg-[var(--bg-elevated)] shadow-[var(--shadow-card)] sm:h-24 sm:w-24">
          <span
            className="text-3xl font-bold text-gold sm:text-4xl"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {statusLabel}
          </span>
        </div>

        <p className="mb-4 text-[0.65rem] font-bold uppercase leading-relaxed tracking-[0.28em] text-gold/70 sm:tracking-[0.4em]">
          {eyebrow}
        </p>

        <h1
          className="mb-5 max-w-2xl text-4xl font-bold leading-tight text-[var(--fg)] sm:text-5xl md:text-6xl"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {title}
        </h1>

        <div className="mb-8 h-0.5 w-14 bg-gold/40" />

        <p className="mb-10 max-w-xl text-base leading-7 text-[var(--fg-muted)] sm:text-lg">
          {message}
        </p>

        <div className="flex w-full max-w-sm flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
          {action ?? (
            <Link
              href="/"
              className="inline-flex min-h-12 items-center justify-center gap-2 bg-navy px-7 py-3 text-xs font-bold uppercase tracking-widest text-gold transition-colors duration-200 hover:bg-navy/85 dark:border dark:border-gold/35"
            >
              <Home size={15} aria-hidden="true" />
              {primaryLabel}
            </Link>
          )}

          <Link
            href="/archive"
            className="inline-flex min-h-12 items-center justify-center gap-2 border border-[var(--border-strong)] px-7 py-3 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] transition-colors duration-200 hover:border-gold hover:text-gold"
          >
            <Search size={15} aria-hidden="true" />
            Browse Archive
          </Link>
        </div>

        {showSearchLink && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-[0.68rem] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
            {[
              { href: '/category/news', label: 'News' },
              { href: '/category/opinion', label: 'Opinion' },
              { href: '/category/analysis', label: 'Analysis' },
              { href: '/opinion-debate', label: 'Debate' },
              { href: '/about', label: 'About' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-10 items-center hover:text-gold"
              >
                {label}
              </Link>
            ))}
          </div>
        )}

        <Link
          href="/"
          className="mt-10 inline-flex items-center gap-2 text-xs font-semibold text-[var(--fg-faint)] transition-colors hover:text-gold"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Return home
        </Link>
      </div>
    </section>
  )
}
