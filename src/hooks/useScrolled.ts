'use client'

import { useEffect, useRef, useState } from 'react'

export function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false)
  const [scrollY, setScrollY] = useState(0)
  const latestState = useRef({ scrolled: false, scrollY: 0 })

  useEffect(() => {
    let frameId: number | null = null

    const handler = () => {
      if (frameId !== null) return

      frameId = window.requestAnimationFrame(() => {
        frameId = null

        const nextScrollY = window.scrollY
        const nextScrolled = nextScrollY > threshold
        const previous = latestState.current

        if (previous.scrollY !== nextScrollY) {
          setScrollY(nextScrollY)
        }

        if (previous.scrolled !== nextScrolled) {
          setScrolled(nextScrolled)
        }

        latestState.current = {
          scrolled: nextScrolled,
          scrollY: nextScrollY,
        }
      })
    }

    window.addEventListener('scroll', handler, { passive: true })
    handler()

    return () => {
      window.removeEventListener('scroll', handler)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [threshold])

  return { scrolled, scrollY }
}
