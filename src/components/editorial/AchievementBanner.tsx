'use client'

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { Award } from 'lucide-react'
import { ACHIEVEMENT_TYPES, GAMIFICATION_API_ROUTES } from '@/lib/constants'

type AchievementRecord = {
  id: string
  type: string
  referenceId: string | null
  awardedAt: string
  seenAt: string | null
  title: string | null
}

type AchievementsResponse = { achievements: AchievementRecord[] }

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<AchievementsResponse>)

function copyFor(achievement: AchievementRecord): string {
  if (achievement.type === ACHIEVEMENT_TYPES.FIRST_PUBLISH) {
    return 'First article published.'
  }
  if (achievement.type === ACHIEVEMENT_TYPES.SERIES_COMPLETE) {
    return achievement.title ? `Series complete: ${achievement.title}.` : 'Series complete.'
  }
  return 'Achievement unlocked.'
}

/**
 * Discreet, one-time banners for unseen writer achievements. After they are
 * shown once they are marked seen, so they do not reappear on the next load.
 */
export function AchievementBanner() {
  const { data } = useSWR<AchievementsResponse>(
    GAMIFICATION_API_ROUTES.achievements,
    fetcher
  )
  const markedRef = useRef(false)

  useEffect(() => {
    if (markedRef.current) return
    const ids = (data?.achievements ?? []).filter((a) => a.seenAt === null).map((a) => a.id)
    if (ids.length === 0) return
    markedRef.current = true
    fetch(GAMIFICATION_API_ROUTES.achievementsMarkSeen, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => {})
  }, [data])

  const unseen = (data?.achievements ?? []).filter((a) => a.seenAt === null)
  if (unseen.length === 0) return null

  return (
    <div className="mb-6 space-y-2" role="status">
      {unseen.map((achievement) => (
        <div
          key={achievement.id}
          className="flex items-center gap-3 border border-gold bg-cream px-5 py-3 text-navy"
        >
          <Award size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-serif)' }}>
            {copyFor(achievement)}
          </p>
        </div>
      ))}
    </div>
  )
}
