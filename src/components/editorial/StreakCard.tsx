import { Flame } from 'lucide-react'

/**
 * The signed-in writer's publishing streak, rendered as a single stats-grid cell.
 *
 * Presentational only (no client hooks): the dashboard fetches the streak
 * server-side via Prisma and passes the values in, matching the trophy-fetch
 * pattern. The label reflects the writer's chosen cadence (intervalWeeks); the
 * cadence itself is changed via the StreakCadenceControl. Shown for WRITER and
 * ADMIN roles only.
 */
export function StreakCard({
  currentStreak,
  longestStreak,
  intervalWeeks,
}: {
  currentStreak: number
  longestStreak: number
  intervalWeeks: number
}) {
  const hasStreak = currentStreak > 0
  const cadenceLabel = intervalWeeks === 1 ? 'week streak' : `${intervalWeeks}-week streak`

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 sm:p-5 shadow-[var(--shadow-card)]">
      <p className="text-[var(--fg-faint)] text-[10px] sm:text-xs uppercase tracking-widest mb-1 sm:mb-2 truncate">
        Publishing streak
      </p>
      {hasStreak ? (
        <>
          <p className="flex items-center gap-2">
            <Flame className="text-gold w-6 h-6 sm:w-7 sm:h-7 shrink-0" aria-hidden="true" />
            <span
              className="text-2xl sm:text-3xl font-bold text-[var(--fg)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {currentStreak}
            </span>
          </p>
          <p className="text-[10px] sm:text-xs text-[var(--fg-muted)] mt-0.5">{cadenceLabel}</p>
        </>
      ) : (
        <p
          className="text-lg sm:text-xl font-bold text-[var(--fg-muted)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Start your streak
        </p>
      )}
      <p className="mt-1 text-[10px] sm:text-xs text-[var(--fg-faint)]">Best: {longestStreak}</p>
    </div>
  )
}
