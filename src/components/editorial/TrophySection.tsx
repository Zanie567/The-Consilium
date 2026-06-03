'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Trophy } from 'lucide-react'

export type TrophyRecord = {
  id: string
  trophy: string
  awardedAt: string
  seenAt: string | null
  article: {
    title: string
    slug: string
  }
}

type TierConfig = {
  label: string
  badgeClass: string
  iconColor: string
}

const TIER_CONFIG: Record<string, TierConfig> = {
  BRONZE: {
    label: 'Bronze',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-300',
    iconColor: '#b45309',
  },
  SILVER: {
    label: 'Silver',
    badgeClass: 'bg-slate-50 text-slate-500 border border-slate-300',
    iconColor: '#94a3b8',
  },
  GOLD: {
    label: 'Gold',
    badgeClass: 'bg-yellow-50 text-[#c9a84c] border border-[#c9a84c]/40',
    iconColor: '#c9a84c',
  },
}

// How long each trophy card stays fully visible before fading out
const DISPLAY_MS = 1800

function TrophyOverlay({ trophy }: { trophy: TrophyRecord }) {
  const cfg = TIER_CONFIG[trophy.trophy]
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -10 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="text-center px-8 py-10 max-w-sm"
      >
        <Trophy
          size={56}
          color={cfg?.iconColor ?? '#c9a84c'}
          className="mx-auto mb-4"
        />
        <p
          className="text-xs font-bold uppercase tracking-widest mb-2"
          style={{ color: cfg?.iconColor ?? '#c9a84c' }}
        >
          {cfg?.label ?? trophy.trophy} Trophy
        </p>
        <p
          className="text-white text-lg font-semibold line-clamp-2"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {trophy.article.title}
        </p>
      </motion.div>
    </motion.div>
  )
}

export function TrophySection({ trophies }: { trophies: TrophyRecord[] }) {
  const unseen = trophies.filter((t) => t.seenAt === null)
  const unseenIds = unseen.map((t) => t.id)

  const [currentIndex, setCurrentIndex] = useState(0)
  // Start hidden; a one-time effect reveals the first overlay after a short
  // delay so the dashboard has a frame to paint before the animation fires.
  const [visible, setVisible] = useState(false)
  const markedRef = useRef(false)
  // Capture the initial unseen count so the entry-delay effect doesn't need
  // to declare `unseen` as a dependency (it's stable, but ESLint can't know).
  const hasUnseenRef = useRef(unseen.length > 0)

  // Reveal the first overlay after a brief delay
  useEffect(() => {
    if (!hasUnseenRef.current) return
    const t = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(t)
  }, [])

  // Auto-dismiss the current overlay after DISPLAY_MS
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => setVisible(false), DISPLAY_MS)
    return () => clearTimeout(t)
  }, [visible, currentIndex])

  // On exit complete: advance to next trophy or fire the mark-seen request
  const handleExitComplete = () => {
    const nextIndex = currentIndex + 1
    if (nextIndex < unseen.length) {
      setCurrentIndex(nextIndex)
      setVisible(true)
    } else if (!markedRef.current && unseenIds.length > 0) {
      markedRef.current = true
      fetch('/api/user/trophies/mark-seen', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unseenIds }),
      }).catch(() => {})
    }
  }

  if (trophies.length === 0) return null

  // Group trophies by article slug for display
  const byArticle = new Map<
    string,
    { title: string; slug: string; trophies: TrophyRecord[] }
  >()
  for (const t of trophies) {
    const key = t.article.slug
    if (!byArticle.has(key)) {
      byArticle.set(key, { ...t.article, trophies: [] })
    }
    const entry = byArticle.get(key)
    if (entry) entry.trophies.push(t)
  }

  return (
    <>
      <AnimatePresence onExitComplete={handleExitComplete}>
        {visible && unseen[currentIndex] && (
          <TrophyOverlay key={unseen[currentIndex].id} trophy={unseen[currentIndex]} />
        )}
      </AnimatePresence>

      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center gap-2">
          <Trophy size={14} className="text-[#c9a84c]" />
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
            My Trophies
          </h2>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {Array.from(byArticle.values()).map(({ title, slug, trophies: articleTrophies }) => (
            <div key={slug} className="px-6 py-4">
              <p className="text-sm font-medium text-[var(--fg)] mb-2 line-clamp-1">{title}</p>
              <div className="flex flex-wrap gap-2">
                {articleTrophies.map((t) => {
                  const cfg = TIER_CONFIG[t.trophy]
                  return (
                    <span
                      key={t.id}
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 ${cfg?.badgeClass ?? ''}`}
                    >
                      <Trophy size={11} />
                      {cfg?.label ?? t.trophy}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
