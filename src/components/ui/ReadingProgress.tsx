'use client'

import { useEffect, useRef } from 'react'

/**
 * Thin gold reading-progress bar. The scroll handler writes the bar's transform
 * directly (once per animation frame) and a short CSS transition smooths it,
 * standing in for the former framer-motion spring without re-rendering React
 * on every scroll event.
 */
export function ReadingProgress() {
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame: number | null = null
    const update = () => {
      frame = null
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress = docHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / docHeight)) : 0
      if (bar.current) bar.current.style.transform = `scaleX(${progress})`
    }
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div
      ref={bar}
      className="reading-progress-bar fixed top-0 left-0 right-0 z-[70] h-[3px] bg-gold origin-left pointer-events-none"
      style={{ transform: 'scaleX(0)' }}
    />
  )
}
