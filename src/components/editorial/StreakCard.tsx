'use client'

import useSWR from 'swr'
import { Flame } from 'lucide-react'
import { GAMIFICATION_API_ROUTES } from '@/lib/constants'

type StreakResponse = {
  currentStreak: number
  longestStreak: number
  lastPublishedAt: string | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<StreakResponse>)

/**
 * The signed-in writer's own publishing streak. Fetched client-side from the
 * session-protected /api/user/streak route, so it only ever shows the current
 * user's data and is never rendered for another writer's profile.
 */
export function StreakCard() {
  const { data } = useSWR<StreakResponse>(GAMIFICATION_API_ROUTES.streak, fetcher)

  if (!data || typeof data.currentStreak !== 'number') return null

  const { currentStreak, longestStreak } = data

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center gap-2">
        <Flame size={14} className="text-gold" aria-hidden="true" />
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
          Publishing streak
        </h2>
      </div>
      <div className="px-6 py-5">
        {currentStreak === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            Start your streak by publishing an article this week.
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2">
              <Flame className="text-gold" size={28} aria-hidden="true" />
              <span
                className="text-3xl font-bold text-[var(--fg)]"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {currentStreak}
              </span>
              <span className="text-sm text-[var(--fg-muted)]">
                {currentStreak === 1 ? 'week' : 'weeks'} in a row
              </span>
            </p>
            <p className="mt-2 text-xs text-[var(--fg-faint)]">
              Longest streak: {longestStreak} {longestStreak === 1 ? 'week' : 'weeks'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
