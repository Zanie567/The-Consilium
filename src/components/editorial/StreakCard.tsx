import { Flame } from 'lucide-react'

/**
 * The signed-in writer's publishing streak, rendered as a single stats-grid cell.
 *
 * Matches StatCard's two-line structure (label + value) exactly so it fits
 * flush in the shared grid without making its row taller than the others.
 * The flame icon appears inline with the number only when a streak is active.
 */
export function StreakCard({ currentStreak }: { currentStreak: number }) {
  const hasStreak = currentStreak > 0

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 sm:p-5 shadow-[var(--shadow-card)]">
      <p className="text-[var(--fg-faint)] text-[10px] sm:text-xs uppercase tracking-widest mb-1 sm:mb-2 truncate">
        Publishing streak
      </p>
      <p className="flex items-center gap-2">
        {hasStreak && (
          <Flame className="text-gold w-6 h-6 sm:w-7 sm:h-7 shrink-0" aria-hidden="true" />
        )}
        <span
          className={`text-2xl sm:text-3xl font-bold ${hasStreak ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)]'}`}
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {currentStreak}
        </span>
      </p>
    </div>
  )
}
