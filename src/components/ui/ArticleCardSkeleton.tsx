/**
 * Pulsing skeleton placeholder that mirrors ArticleCard's DOM structure exactly.
 *
 * Structure match (ArticleCard → skeleton):
 *   article.h-full.flex.flex-col
 *     div.h-48.flex-shrink-0          → image shimmer block
 *     div.p-5.flex.flex-col.flex-1    → content area
 *       h3.flex-1.mb-2 (line-clamp-2, text-base leading-snug ≈ 22px/line)
 *                                     → flex-1 div + 2 × h-5 bars
 *       p.mb-4 (line-clamp-2, text-sm leading-relaxed)
 *                                     → 2 × h-4 bars in mb-4 div
 *       div.border-t.pt-3 (author / date row)
 *                                     → 2 × h-3 bars
 *
 * Shimmer: defined in globals.css (.skeleton-shimmer).
 * Animation is disabled automatically by the global prefers-reduced-motion rule.
 */
export function ArticleCardSkeleton() {
  return (
    <div
      className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden shadow-[var(--shadow-card)] h-full flex flex-col"
      aria-hidden="true"
    >
      {/* Image area - h-48 flex-shrink-0 to match ArticleCard */}
      <div className="relative h-48 flex-shrink-0 overflow-hidden">
        <div className="absolute inset-0 skeleton-shimmer" />
      </div>

      {/* Content - p-5 flex-col flex-1 to match ArticleCard */}
      <div className="p-5 flex flex-col flex-1">

        {/* Title - mirrors h3.flex-1.mb-2 (text-base leading-snug ≈ 22 px/line) */}
        <div className="flex-1 mb-2">
          <div className="skeleton-shimmer h-5 w-full rounded-sm mb-1.5" />
          <div className="skeleton-shimmer h-5 w-4/5 rounded-sm" />
        </div>

        {/* Excerpt - mirrors p.mb-4 (text-sm leading-relaxed, line-clamp-2 = 2 lines) */}
        <div className="mb-4">
          <div className="skeleton-shimmer h-4 w-full rounded-sm mb-1.5" />
          <div className="skeleton-shimmer h-4 w-11/12 rounded-sm" />
        </div>

        {/* Footer - mirrors div.border-t.pt-3.flex.items-center.justify-between */}
        <div className="border-t border-[var(--border)] pt-3 flex items-center justify-between">
          <div className="skeleton-shimmer h-3 w-24 rounded-sm" />
          <div className="skeleton-shimmer h-3 w-16 rounded-sm" />
        </div>

      </div>
    </div>
  )
}
