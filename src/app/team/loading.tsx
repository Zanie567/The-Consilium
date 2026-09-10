/**
 * Bug 7 (site audit): the Team page is a dynamic server component that fetches
 * members on every request, so navigating to it showed a blank content area for
 * 1–2s. Next.js streams this skeleton while page.tsx resolves.
 *
 * The shape mirrors the masthead tiers (one lead card, a leadership pair, an
 * editorial row) so the swap to real content does not jump.
 */

function CardSkeleton({ width, photo }: { width: string; photo: string }) {
  return (
    <div
      className={`${width} bg-[var(--bg-elevated)] border border-[var(--border)] px-5 py-6 flex flex-col items-center text-center`}
    >
      <div className={`${photo} rounded-full bg-[var(--bg-subtle)] mb-4`} />
      <div className="h-5 w-32 bg-[var(--bg-subtle)] rounded mb-2" />
      <div className="h-3 w-24 bg-[var(--bg-subtle)] rounded mb-4" />
      <div className="h-3 w-full bg-[var(--bg-subtle)] rounded mb-1.5" />
      <div className="h-3 w-4/5 bg-[var(--bg-subtle)] rounded" />
    </div>
  )
}

export default function TeamLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header (matches the real page header so the transition is seamless) */}
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">The Consilium</p>
        <h1
          className="text-4xl sm:text-5xl font-bold text-gold mb-4"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Our Team
        </h1>
        <p className="text-cream/60 text-sm max-w-xl mx-auto">
          The students and society members who produce The Consilium
        </p>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 animate-pulse">
        <div className="flex justify-center">
          <CardSkeleton width="w-full sm:w-[26rem]" photo="w-32 h-32" />
        </div>
        <div className="mt-6 sm:mt-8 flex flex-wrap justify-center gap-5 sm:gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <CardSkeleton key={i} width="w-full sm:w-[19rem]" photo="w-24 h-24" />
          ))}
        </div>
        <div className="mt-14 sm:mt-20 flex items-center gap-5 mb-9 sm:mb-11">
          <span className="h-px flex-1 bg-[var(--border-strong)]" />
          <div className="h-3 w-24 bg-[var(--bg-subtle)] rounded" />
          <span className="h-px flex-1 bg-[var(--border-strong)]" />
        </div>
        <div className="flex flex-wrap justify-center gap-5 sm:gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} width="w-full sm:w-[16.5rem]" photo="w-20 h-20" />
          ))}
        </div>
      </div>
    </div>
  )
}
