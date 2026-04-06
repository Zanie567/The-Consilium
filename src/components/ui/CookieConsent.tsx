'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'

const CONSENT_KEY = 'consilium_cookie_consent'

export type CookieConsent = 'accepted' | 'declined' | null

export function getCookieConsent(): CookieConsent {
  if (typeof window === 'undefined') return null
  const val = localStorage.getItem(CONSENT_KEY)
  if (val === 'accepted' || val === 'declined') return val
  return null
}

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const existing = getCookieConsent()
    if (!existing) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem(CONSENT_KEY, 'accepted')
    setVisible(false)
  }

  function decline() {
    localStorage.setItem(CONSENT_KEY, 'declined')
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-0 left-0 right-0 z-[100] bg-navy border-t border-gold/20 shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
          role="dialog"
          aria-label="Cookie consent"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center gap-3 sm:gap-6">
            <p className="text-cream/70 text-xs leading-relaxed text-center sm:text-left flex-1">
              This site uses cookies to improve your experience.{' '}
              <Link href="/privacy" className="text-gold hover:underline">
                Privacy Policy
              </Link>
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={decline}
                className="text-cream/50 text-xs font-bold uppercase tracking-widest px-4 py-2 border border-cream/15 hover:border-cream/30 hover:text-cream/70 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={accept}
                className="text-navy text-xs font-bold uppercase tracking-widest px-4 py-2 bg-gold hover:bg-gold/85 transition-colors"
              >
                Accept
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
