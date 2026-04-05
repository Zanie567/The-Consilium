'use client'

/**
 * SignupPrompt — appears after the visitor's 3rd page view in the bottom right.
 *
 * Rules:
 * - Never shown to logged-in users
 * - Never shown before 3 visits (cookie: consilium_visits)
 * - Dismissed: hidden for 7 days (cookie: consilium_prompt_dismissed)
 * - After signup/login the cookies are ignored (session exists)
 */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

const VISIT_KEY = 'consilium_visits'
const DISMISS_KEY = 'consilium_prompt_dismissed'
const VISIT_THRESHOLD = 3
const DISMISS_DAYS = 7

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

export function SignupPrompt() {
  const { data: session, status } = useSession()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (session) return // logged in — never show

    // Check if dismissed recently
    const dismissed = getCookie(DISMISS_KEY)
    if (dismissed) {
      const ts = parseInt(dismissed, 10)
      if (Date.now() - ts < DISMISS_DAYS * 86_400_000) return
    }

    // Increment visit counter
    const raw = getCookie(VISIT_KEY)
    const visits = raw ? parseInt(raw, 10) + 1 : 1
    setCookie(VISIT_KEY, String(visits), 365)

    if (visits >= VISIT_THRESHOLD) {
      // Show after a short delay so it doesn't jar on page load
      const timer = setTimeout(() => setVisible(true), 3500)
      return () => clearTimeout(timer)
    }
  }, [session, status])

  const dismiss = () => {
    setVisible(false)
    setCookie(DISMISS_KEY, String(Date.now()), DISMISS_DAYS)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-6 right-4 sm:right-6 z-[90] w-[300px] bg-navy border border-gold/30 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
          role="dialog"
          aria-label="Create an account"
        >
          {/* Gold top accent */}
          <div className="h-[2px] bg-gradient-to-r from-gold/30 via-gold to-gold/30" />

          <div className="p-5">
            {/* Dismiss */}
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="absolute top-3 right-3 text-cream/30 hover:text-cream/70 transition-colors"
            >
              <X size={14} />
            </button>

            {/* Masthead micro */}
            <p className="text-gold text-[0.55rem] font-bold tracking-[0.35em] uppercase mb-3 opacity-70">
              The Consilium
            </p>

            <h3
              className="text-cream text-base font-bold leading-snug mb-2"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Make The Consilium yours.
            </h3>
            <p className="text-cream/60 text-xs leading-relaxed mb-4">
              Create a free account to save articles, track your reading progress, and pick up exactly where you left off — on any device.
            </p>

            <div className="flex flex-col gap-2">
              <Link
                href="/signup"
                onClick={dismiss}
                className="block w-full bg-gold text-navy text-xs font-bold uppercase tracking-widest py-2.5 text-center hover:bg-gold/85 transition-colors"
              >
                Create Account
              </Link>
              <button
                onClick={dismiss}
                className="w-full border border-cream/15 text-cream/40 text-xs font-bold uppercase tracking-widest py-2 hover:border-cream/30 hover:text-cream/60 transition-colors"
              >
                Maybe Later
              </button>
            </div>

            <p className="text-cream/25 text-[10px] text-center mt-3">
              Free forever. No spam.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
