'use client'

import { useEffect, useState } from 'react'

/**
 * Mount/unmount with CSS enter and exit transitions, the small part of
 * framer-motion's AnimatePresence the site chrome needs.
 *
 *   const { mounted, shown } = usePresence(open, 300)
 *   {mounted && <div data-shown={shown} className="... transition ..." />}
 *
 * `mounted` turns true immediately and false `exitMs` after `open` turns false.
 * `shown` turns true on the frame after mounting (so the "from" styles paint
 * first and the transition runs) and false as soon as `open` turns false.
 * The element is therefore absent from the DOM whenever it is closed, exactly
 * as it was with AnimatePresence. Reduced-motion users get no exit delay.
 */
export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Two frames: the first commits the mounted "from" state, the second flips it.
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }
    setShown(false)
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => setMounted(false), reduced ? 0 : exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs])

  return { mounted: mounted || open, shown: open && shown }
}
