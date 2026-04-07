/**
 * Pulsing skeleton placeholder that matches ArticleCard dimensions exactly.
 * Uses .skeleton-shimmer (defined in globals.css) for the shimmer effect.
 * Shimmer is disabled automatically via the global prefers-reduced-motion rule.
 */
export function ArticleCardSkeleton() {
  return (
    <div
      className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden shadow-[var(--shadow-card)] h-full flex flex-col"
      aria-hidden="true"
    >
      {/* Image area — matches h-48 */}
      <div className="relative h-48 flex-shrink-0 overflow-hidden">
        <div className="absolute inset-0 skeleton-shimmer" />
      </div>

      {/* Content area — matches p-5 */}
      <div className="p-5 flex flex-col flex-1 gap-2">
        {/* Title lines */}
        <div className="skeleton-shimmer h-4 w-full rounded-sm" />
        <div className="skeleton-shimmer h-4 w-4/5 rounded-sm mb-1" />

        {/* Excerpt lines */}
        <div className="skeleton-shimmer h-3 w-full rounded-sm" />
        <div className="skeleton-shimmer h-3 w-11/12 rounded-sm" />
        <div className="skeleton-shimmer h-3 w-3/4 rounded-sm mb-2" />

        {/* Footer */}
        <div className="mt-auto pt-3 border-t border-[var(--border)] flex items-center justify-between">
          <div className="skeleton-shimmer h-3 w-24 rounded-sm" />
          <div className="skeleton-shimmer h-3 w-16 rounded-sm" />
        </div>
      </div>
    </div>
  )
}
