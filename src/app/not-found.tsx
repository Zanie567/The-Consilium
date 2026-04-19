import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page Not Found',
}

export default function NotFound() {
  return (
    <div className="min-h-[70vh] bg-[var(--bg)] flex flex-col items-center justify-center px-4 py-24 text-center">
      {/* Eyebrow */}
      <p className="text-gold/60 text-[0.65rem] tracking-[0.4em] uppercase mb-4 font-semibold">
        404
      </p>

      {/* Heading */}
      <h1
        className="text-5xl sm:text-6xl font-bold text-[var(--fg)] mb-4"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Page Not Found
      </h1>

      {/* Divider */}
      <div className="w-12 h-0.5 bg-gold/40 mx-auto mb-6" />

      {/* Message */}
      <p className="text-[var(--fg-muted)] text-base sm:text-lg max-w-md leading-relaxed mb-10">
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have been moved.
        Try navigating from the homepage.
      </p>

      {/* CTA */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 bg-navy text-gold border border-gold/40 px-8 py-3 text-xs font-bold uppercase tracking-widest hover:bg-navy/80 transition-colors duration-200"
      >
        ← Back to Homepage
      </Link>

      {/* Quick nav links */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-xs font-semibold uppercase tracking-widest text-[var(--fg-faint)]">
        {[
          { href: '/category/news',      label: 'News' },
          { href: '/category/opinion',   label: 'Opinion' },
          { href: '/category/analysis',  label: 'Analysis' },
          { href: '/opinion-debate',     label: 'Debate' },
          { href: '/about',              label: 'About' },
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="hover:text-gold transition-colors duration-150"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}
