/**
 * Bug 6: All Articles page showed blank content for ~2–3 s on initial load.
 * Next.js serves this file automatically while the async server component
 * (page.tsx) is fetching data via React Suspense streaming.
 *
 * Lives in the (list) route group so it wraps only the articles list. A loading.tsx
 * directly under articles/ would also wrap /new and /[id]/edit, putting this table
 * skeleton on editor pages and sending their navigations through Next's optimistic
 * loading-shell path, where the commit can be lost and the portal content stays empty
 * (wf-public-controls "signed-in phone ... New Article": 3 of 100 runs with the boundary
 * at articles/, 0 of 100 without). See tests/unit/editor-routes-no-loading-boundary.test.ts.
 */
export default function ArticlesLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl animate-pulse" role="status" aria-label="Loading articles">
      {/* Page header skeleton */}
      <div className="mb-6 flex items-center justify-between pl-10 md:pl-0">
        <div>
          <div className="h-7 w-40 bg-[var(--bg-subtle)] rounded mb-2" />
          <div className="h-4 w-24 bg-[var(--bg-subtle)] rounded" />
        </div>
        <div className="h-10 w-20 bg-[var(--bg-subtle)] rounded" />
      </div>

      {/* Search, format and sort skeleton */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="h-10 flex-1 bg-[var(--bg-subtle)]" />
        <div className="flex gap-2">
          <div className="h-10 flex-1 bg-[var(--bg-subtle)] sm:w-44 sm:flex-none" />
          <div className="h-10 flex-1 bg-[var(--bg-subtle)] sm:w-52 sm:flex-none" />
        </div>
      </div>

      {/* Status filter tabs skeleton */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {['All', 'Draft', 'Published', 'Scheduled'].map((label) => (
          <div
            key={label}
            className="h-9 w-20 bg-[var(--bg-subtle)] rounded"
          />
        ))}
      </div>

      {/* List skeleton: a thumbnail, two lines of text, a status and the actions per row */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
        <div className="hidden border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3 md:flex md:gap-4">
          <div className="h-3 w-20 bg-[var(--border)] rounded flex-1" />
          <div className="h-3 w-16 bg-[var(--border)] rounded" />
          <div className="h-3 w-20 bg-[var(--border)] rounded" />
        </div>

        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="border-b border-[var(--border)] last:border-0 px-3 py-3 md:px-4 flex flex-wrap items-center gap-3 md:flex-nowrap md:gap-4"
          >
            <div className="aspect-[3/2] w-[5.25rem] shrink-0 bg-[var(--bg-subtle)] md:w-24" />
            <div className="flex-1 min-w-0 space-y-2">
              <div
                className="h-4 bg-[var(--bg-subtle)] rounded"
                style={{ width: `${55 + (i % 4) * 10}%` }}
              />
              <div className="h-3 w-40 bg-[var(--bg-subtle)] rounded" />
            </div>
            <div className="h-5 w-20 bg-[var(--bg-subtle)] rounded" />
            <div className="hidden items-center gap-1.5 md:flex">
              <div className="h-5 w-8 bg-[var(--bg-subtle)] rounded" />
              <div className="h-5 w-14 bg-[var(--bg-subtle)] rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
