import { ArticleCardSkeleton } from '@/components/ui/ArticleCardSkeleton'

export default function CategoryLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header skeleton - mirrors the navy header */}
      <section className="bg-navy py-14 px-4 border-b border-gold/25">
        <div className="max-w-7xl mx-auto space-y-3">
          <div className="h-2.5 w-14 rounded-sm bg-gold/20 skeleton-shimmer" />
          <div className="h-10 w-44 rounded-sm bg-gold/20 skeleton-shimmer" />
          <div className="h-2.5 w-20 rounded-sm bg-gold/20 skeleton-shimmer" />
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <ArticleCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
