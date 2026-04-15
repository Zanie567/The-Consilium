'use client'

/**
 * ReadingTracker - replaces ReadingProgress for article pages.
 *
 * For logged-in users:
 *   - Saves scroll progress to the DB (debounced, every 4s)
 *   - On mount: fetches saved position and offers to restore it
 *   - Shows a "Continue where you left off" banner if progress > 5%
 *
 * For guests:
 *   - Saves to localStorage
 *   - Restores on return
 *   - Shows a subtle "create account to sync" nudge
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, useMotionValue, useSpring, AnimatePresence } from 'framer-motion'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { BookOpen, X } from 'lucide-react'

const LS_KEY = (id: string) => `consilium_rp_${id}`

interface SavedProgress {
  progress: number
  scrollY: number
}

export function ReadingTracker({ articleId }: { articleId: string }) {
  const { data: session } = useSession()
  const rawProgress = useMotionValue(0)
  const scaleX = useSpring(rawProgress, { stiffness: 200, damping: 35, restDelta: 0.001 })

  const [restoreBanner, setRestoreBanner] = useState<{ scrollY: number; progress: number } | null>(null)
  const [guestNudge, setGuestNudge] = useState(false)
  const lastSaved = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasScrolled = useRef(false)

  // ── Progress bar tracking ─────────────────────────────────────────────────
  const getProgress = useCallback(() => {
    const docH = document.documentElement.scrollHeight - window.innerHeight
    return docH > 0 ? (window.scrollY / docH) * 100 : 0
  }, [])

  // ── Persist progress ──────────────────────────────────────────────────────
  const persist = useCallback((pct: number, scrollY: number) => {
    if (session?.user?.id) {
      fetch('/api/reading-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, progress: pct, scrollY }),
      }).catch(() => {})
    } else {
      try {
        localStorage.setItem(LS_KEY(articleId), JSON.stringify({ progress: pct, scrollY }))
      } catch {}
    }
  }, [articleId, session])

  // ── Scroll handler ────────────────────────────────────────────────────────
  useEffect(() => {
    const onScroll = () => {
      const pct = getProgress()
      rawProgress.set(pct / 100)
      hasScrolled.current = true

      const now = Date.now()
      if (now - lastSaved.current > 4000) {
        lastSaved.current = now
        persist(pct, window.scrollY)
      } else {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          lastSaved.current = Date.now()
          persist(pct, window.scrollY)
        }, 4000)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [getProgress, persist, rawProgress])

  // ── Load saved position on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const tryRestore = (saved: SavedProgress | null) => {
      if (cancelled) return
      if (saved && saved.progress > 5 && saved.scrollY > 200) {
        setRestoreBanner(saved)
        // Guest nudge: show upgrade prompt once per session if not logged in
        if (!session?.user?.id) {
          const alreadySeen = sessionStorage.getItem('consilium_nudge_seen')
          if (!alreadySeen) {
            setTimeout(() => setGuestNudge(true), 800)
            sessionStorage.setItem('consilium_nudge_seen', '1')
          }
        }
      }
    }

    if (session?.user?.id) {
      fetch(`/api/reading-progress/${articleId}`)
        .then((r) => r.json())
        .then((data) => tryRestore(data))
        .catch(() => {})
    } else {
      try {
        const raw = localStorage.getItem(LS_KEY(articleId))
        if (raw) tryRestore(JSON.parse(raw))
      } catch {}
    }

    return () => { cancelled = true }
  }, [articleId, session])

  const scrollToSaved = (scrollY: number) => {
    window.scrollTo({ top: scrollY, behavior: 'smooth' })
    setRestoreBanner(null)
  }

  return (
    <>
      {/* Progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 z-[70] h-[3px] bg-gold origin-left pointer-events-none"
        style={{ scaleX }}
      />

      {/* Restore banner */}
      <AnimatePresence>
        {restoreBanner && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed top-16 inset-x-0 z-[60] flex justify-center px-4 pointer-events-none"
          >
            <div className="pointer-events-auto bg-navy border border-gold/30 shadow-xl flex items-center gap-3 px-4 py-2.5 max-w-sm w-full">
              <BookOpen size={15} className="text-gold shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-cream text-xs font-semibold leading-snug">
                  Continue where you left off
                </p>
                <p className="text-cream/45 text-[10px]">
                  {Math.round(restoreBanner.progress)}% through this article
                </p>
              </div>
              <button
                onClick={() => scrollToSaved(restoreBanner.scrollY)}
                className="shrink-0 bg-gold text-navy text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-gold/85 transition-colors"
              >
                Jump back
              </button>
              <button
                onClick={() => setRestoreBanner(null)}
                aria-label="Dismiss"
                className="text-cream/40 hover:text-cream transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Guest nudge */}
      <AnimatePresence>
        {guestNudge && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed bottom-6 right-4 sm:right-6 z-[60] max-w-[280px] bg-navy border border-gold/25 shadow-2xl p-4"
          >
            <button
              onClick={() => setGuestNudge(false)}
              aria-label="Dismiss"
              className="absolute top-2 right-2 text-cream/30 hover:text-cream/70 transition-colors"
            >
              <X size={13} />
            </button>
            <p className="text-gold text-[0.6rem] font-bold uppercase tracking-[0.25em] mb-1.5">
              Reading progress saved
            </p>
            <p className="text-cream/70 text-xs leading-relaxed mb-3">
              Your place is saved on this device.{' '}
              <span className="text-cream/90">Create a free account</span> to continue reading on any device.
            </p>
            <div className="flex gap-2">
              <Link
                href="/signup"
                onClick={() => setGuestNudge(false)}
                className="flex-1 bg-gold text-navy text-[10px] font-bold uppercase tracking-widest py-2 text-center hover:bg-gold/85 transition-colors"
              >
                Create Account
              </Link>
              <button
                onClick={() => setGuestNudge(false)}
                className="flex-1 border border-cream/20 text-cream/50 text-[10px] font-bold uppercase tracking-widest py-2 hover:border-cream/40 hover:text-cream/70 transition-colors"
              >
                Maybe Later
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
