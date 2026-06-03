/**
 * Compact "read quality" indicator for an article, derived from its engagement
 * score (0-100). Dashboard-only; never rendered on public article pages.
 *
 * Pure presentational component (no client hooks) so it can render inside the
 * server-rendered dashboard table.
 */
export function ReadQualityBadge({ score }: { score: number | null }) {
  const value = Math.max(0, Math.min(100, Math.round(score ?? 0)))

  return (
    <div className="flex items-center gap-2" title={`Read quality: ${value} out of 100`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-faint)]">
        Read quality
      </span>
      <span
        className="relative h-1.5 w-16 overflow-hidden rounded-full bg-[var(--bg-subtle)]"
        aria-hidden="true"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-gold"
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="text-xs font-bold text-gold">{value}</span>
    </div>
  )
}
