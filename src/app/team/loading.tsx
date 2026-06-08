/**
 * Bug 7 (site audit): the Team page is a dynamic server component that fetches
 * members on every request, so navigating to it showed a blank content area for
 * 1–2s. Next.js streams this skeleton while page.tsx resolves.
 */
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

      {/* Member card grid skeleton */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 flex flex-col items-center text-center"
            >
              {/* Avatar */}
              <div className="w-24 h-24 rounded-full bg-[var(--bg-subtle)] mb-4" />
              {/* Name */}
              <div className="h-5 w-32 bg-[var(--bg-subtle)] rounded mb-2" />
              {/* Role */}
              <div className="h-3 w-24 bg-[var(--bg-subtle)] rounded mb-4" />
              {/* Bio lines */}
              <div className="h-3 w-full bg-[var(--bg-subtle)] rounded mb-1.5" />
              <div className="h-3 w-5/6 bg-[var(--bg-subtle)] rounded mb-1.5" />
              <div className="h-3 w-2/3 bg-[var(--bg-subtle)] rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
