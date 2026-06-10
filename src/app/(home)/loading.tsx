import { ArticleCardSkeleton } from '@/components/ui/ArticleCardSkeleton'

export default function HomeLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {/* Featured article skeleton */}
        <div className="mb-12 border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="relative h-64 lg:min-h-[400px] overflow-hidden">
              <div className="absolute inset-0 skeleton-shimmer" />
            </div>
            <div className="p-8 lg:p-12 flex flex-col justify-center gap-3">
              <div className="skeleton-shimmer h-3 w-16 rounded-sm" />
              <div className="skeleton-shimmer h-8 w-full rounded-sm" />
              <div className="skeleton-shimmer h-8 w-4/5 rounded-sm" />
              <div className="skeleton-shimmer h-4 w-full rounded-sm mt-2" />
              <div className="skeleton-shimmer h-4 w-5/6 rounded-sm" />
              <div className="skeleton-shimmer h-4 w-3/4 rounded-sm" />
              <div className="skeleton-shimmer h-10 w-36 rounded-sm mt-4" />
            </div>
          </div>
        </div>

        {/* Tab row skeleton */}
        <div className="flex gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-8 w-20 rounded-sm" />
          ))}
        </div>

        {/* Article grid skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <ArticleCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
