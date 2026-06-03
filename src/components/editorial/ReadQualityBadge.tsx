import { ENGAGEMENT_QUALITY_GOLD_THRESHOLD } from '@/lib/constants'

/**
 * Compact "read quality" badge for an article, derived from its engagement score
 * (0-100). Dashboard-only; never rendered on public article pages.
 *
 * A null score means the article has not been scored yet (the cron has not run for
 * it), so it shows a neutral "Not yet scored" placeholder rather than a misleading
 * "0.0". A real score shows to one decimal place: gold (#c9a84c) above the quality
 * threshold, neutral muted text at or below it. Pure presentational component (no
 * client hooks) so it can render inside the server-rendered dashboard table.
 */
export function ReadQualityBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span
        className="inline-block text-xs font-medium text-[var(--fg-faint)]"
        title="Read quality score: not yet available"
      >
        Not yet scored
      </span>
    )
  }

  const value = Math.max(0, Math.min(100, score))
  const isHigh = value > ENGAGEMENT_QUALITY_GOLD_THRESHOLD

  return (
    <span
      className={`inline-block text-xs font-bold tabular-nums ${
        isHigh ? 'text-[#c9a84c]' : 'text-[var(--fg-muted)]'
      }`}
      title={`Read quality score: ${value.toFixed(1)} out of 100`}
    >
      {value.toFixed(1)}
    </span>
  )
}
