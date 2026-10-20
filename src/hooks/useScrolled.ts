'use client'

import { useEffect, useState } from 'react'

/**
 * Whether the page has scrolled past `threshold` pixels.
 *
 * Only the boolean is kept in state, so the caller re-renders when the page
 * crosses the threshold and not on every scroll frame. (An earlier version also
 * stored scrollY, which re-rendered the site-wide Navbar ~60 times a second
 * while scrolling even though nothing read the value.)
 */
export function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let frameId: number | null = null
    const check = () => {
      frameId = null
      // Same-value updates bail out without rendering.
      setScrolled(window.scrollY > threshold)
    }
    const handler = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(check)
    }

    window.addEventListener('scroll', handler, { passive: true })
    check()

    return () => {
      window.removeEventListener('scroll', handler)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [threshold])

  return { scrolled }
}
