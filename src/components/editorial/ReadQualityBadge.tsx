import { ENGAGEMENT_QUALITY_GOLD_THRESHOLD } from '@/lib/constants'

/**
 * Compact "read quality" badge for an article, derived from its engagement score
 * (0-100). Dashboard-only; never rendered on public article pages.
 *
 * Shows the score to one decimal place. Gold (#c9a84c) above the quality
 * threshold, neutral muted text at or below it. Pure presentational component (no
 * client hooks) so it can render inside the server-rendered dashboard table.
 */
export function ReadQualityBadge({ score }: { score: number | null }) {
  const value = Math.max(0, Math.min(100, score ?? 0))
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
