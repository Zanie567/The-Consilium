'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

const STORAGE_KEY = 'consilium_install_dismissed'

type Platform = 'ios' | 'android' | null

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return null
}

function isAlreadyInstalled(): boolean {
  if (typeof window === 'undefined') return true
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari iOS standalone
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function InstallBanner() {
  const [visible, setVisible] = useState(false)
  const [platform, setPlatform] = useState<Platform>(null)

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY)
    if (dismissed) return
    if (isAlreadyInstalled()) return
    const p = detectPlatform()
    if (!p) return
    setPlatform(p)
    setVisible(true)
  }, [])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible || !platform) return null

  return (
    <div
      role="banner"
      className="fixed bottom-0 inset-x-0 z-[70] bg-navy border-t-2 border-gold shadow-[0_-8px_32px_rgba(0,0,0,0.4)] px-4 py-4 flex items-start gap-4"
    >
      {/* Gold accent line */}
      <div className="flex-1 min-w-0">
        <p className="text-gold text-[0.65rem] font-bold tracking-[0.25em] uppercase mb-1">
          Install The Consilium
        </p>

        {platform === 'ios' ? (
          <p className="text-cream/80 text-sm leading-relaxed">
            Add this app to your Home Screen for quick access.{' '}
            <span className="text-cream/60">
              Tap the{' '}
              <span className="text-gold font-semibold">Share</span>{' '}
              button{' '}
              <span className="inline-block text-base leading-none align-middle">⎋</span>
              {' '}then select{' '}
              <span className="text-gold font-semibold">&ldquo;Add to Home Screen&rdquo;</span>.
            </span>
          </p>
        ) : (
          <p className="text-cream/80 text-sm leading-relaxed">
            Add this app to your Home Screen for quick access.{' '}
            <span className="text-cream/60">
              Tap the{' '}
              <span className="text-gold font-semibold">browser menu</span>{' '}
              (⋮) and select{' '}
              <span className="text-gold font-semibold">&ldquo;Add to Home Screen&rdquo;</span>{' '}
              or{' '}
              <span className="text-gold font-semibold">&ldquo;Install app&rdquo;</span>.
            </span>
          </p>
        )}
      </div>

      <button
        onClick={dismiss}
        aria-label="Dismiss install banner"
        className="shrink-0 text-cream/40 hover:text-cream transition-colors p-1 mt-0.5"
      >
        <X size={18} />
      </button>
    </div>
  )
}
