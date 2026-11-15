/**
 * Shown while the archive's queries run: on the first request (the header and this shell are
 * sent at once and the list streams in after) and while moving between pages or filters.
 *
 * It mirrors the page's own boxes (header, filter bar, a lead article, then rows) so nothing
 * jumps when the real content replaces it. The shimmer stops under prefers-reduced-motion
 * (globals.css).
 */
export default function ArchiveLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="border-b-2 border-gold bg-navy">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h1 className="text-5xl font-bold text-gold sm:text-6xl" style={{ fontFamily: 'var(--font-serif)' }}>
            Archive
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-cream/75 sm:text-lg">
            Every article The Consilium has published, newest first. Search by headline, author or topic, or narrow
            the list by format.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8" role="status" aria-label="Loading the archive">
        <div aria-hidden="true">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="skeleton-shimmer h-12 flex-1" />
            <div className="skeleton-shimmer h-12 sm:w-52" />
            <div className="skeleton-shimmer h-12 sm:w-40" />
          </div>
          <div className="skeleton-shimmer mt-3 h-12" />
          <div className="mt-8 border-b border-[var(--border-strong)] pb-3">
            <div className="skeleton-shimmer h-4 w-40" />
          </div>

          <div className="grid gap-6 border-b border-[var(--border-strong)] pb-10 pt-8 lg:grid-cols-12 lg:gap-10 lg:pb-12">
            <div className="skeleton-shimmer aspect-[3/2] lg:col-span-7" />
            <div className="flex flex-col justify-center gap-4 lg:col-span-5">
              <div className="skeleton-shimmer h-4 w-28" />
              <div className="skeleton-shimmer h-9 w-full" />
              <div className="skeleton-shimmer h-9 w-4/5" />
              <div className="skeleton-shimmer h-4 w-full" />
              <div className="skeleton-shimmer h-4 w-11/12" />
              <div className="skeleton-shimmer h-4 w-36" />
            </div>
          </div>

          <div className="mt-10 lg:mt-12 lg:grid lg:grid-cols-[8.5rem_minmax(0,1fr)] lg:gap-10">
            <div className="border-b border-[var(--border-strong)] pb-2 lg:border-b-0 lg:border-t-2 lg:border-gold lg:pb-0 lg:pt-3">
              <div className="skeleton-shimmer h-7 w-28" />
            </div>
            <div className="divide-y divide-[var(--border)] lg:[&>div:first-child]:pt-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_6.75rem] gap-4 py-6 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:gap-7 sm:py-7 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
                  <div className="skeleton-shimmer order-2 aspect-[3/2] self-start sm:order-1" />
                  <div className="order-1 space-y-3 sm:order-2">
                    <div className="skeleton-shimmer h-4 w-32" />
                    <div className="skeleton-shimmer h-6" style={{ width: `${88 - (i % 3) * 14}%` }} />
                    <div className="skeleton-shimmer hidden h-4 w-full sm:block" />
                    <div className="skeleton-shimmer h-4 w-44" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
