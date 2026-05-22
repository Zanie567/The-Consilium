/**
 * Bug 6: All Articles page showed blank content for ~2–3 s on initial load.
 * Next.js serves this file automatically while the async server component
 * (page.tsx) is fetching data via React Suspense streaming.
 */
export default function ArticlesLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl animate-pulse">
      {/* Page header skeleton */}
      <div className="mb-6 flex items-center justify-between pl-10 md:pl-0">
        <div>
          <div className="h-7 w-40 bg-[var(--bg-subtle)] rounded mb-2" />
          <div className="h-4 w-24 bg-[var(--bg-subtle)] rounded" />
        </div>
        <div className="h-10 w-20 bg-[var(--bg-subtle)] rounded" />
      </div>

      {/* Status filter tabs skeleton */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {['All', 'Draft', 'Published', 'Scheduled'].map((label) => (
          <div
            key={label}
            className="h-8 w-20 bg-[var(--bg-subtle)] rounded"
          />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
        {/* Table header */}
        <div className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-5 py-3 flex gap-4">
          <div className="h-3 w-32 bg-[var(--border)] rounded flex-1" />
          <div className="h-3 w-20 bg-[var(--border)] rounded hidden md:block" />
          <div className="h-3 w-20 bg-[var(--border)] rounded hidden sm:block" />
          <div className="h-3 w-20 bg-[var(--border)] rounded hidden lg:block" />
          <div className="h-3 w-16 bg-[var(--border)] rounded" />
          <div className="h-3 w-20 bg-[var(--border)] rounded" />
        </div>

        {/* Table rows — 8 placeholder rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="border-b border-[var(--border)] last:border-0 px-5 py-3 flex items-center gap-4"
          >
            {/* Title column */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div
                className="h-4 bg-[var(--bg-subtle)] rounded"
                style={{ width: `${55 + (i % 4) * 10}%` }}
              />
            </div>
            {/* Author */}
            <div className="h-3 w-24 bg-[var(--bg-subtle)] rounded hidden md:block" />
            {/* Category */}
            <div className="h-3 w-20 bg-[var(--bg-subtle)] rounded hidden sm:block" />
            {/* Updated */}
            <div className="h-3 w-20 bg-[var(--bg-subtle)] rounded hidden lg:block" />
            {/* Status badge */}
            <div className="h-5 w-16 bg-[var(--bg-subtle)] rounded" />
            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <div className="h-5 w-8 bg-[var(--bg-subtle)] rounded" />
              <div className="h-5 w-14 bg-[var(--bg-subtle)] rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
