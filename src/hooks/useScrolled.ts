'use client'

import { useEffect, useState } from 'react'

export function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false)
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    const handler = () => {
      const y = window.scrollY
      setScrollY(y)
      setScrolled(y > threshold)
    }
    window.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => window.removeEventListener('scroll', handler)
  }, [threshold])

  return { scrolled, scrollY }
}
