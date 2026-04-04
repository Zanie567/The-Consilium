'use client'

import { useEffect } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

export function ReadingProgress() {
  const rawProgress = useMotionValue(0)
  const scaleX = useSpring(rawProgress, { stiffness: 200, damping: 35, restDelta: 0.001 })

  useEffect(() => {
    const update = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      rawProgress.set(docHeight > 0 ? window.scrollY / docHeight : 0)
    }
    window.addEventListener('scroll', update, { passive: true })
    update()
    return () => window.removeEventListener('scroll', update)
  }, [rawProgress])

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 z-[70] h-[3px] bg-gold origin-left pointer-events-none"
      style={{ scaleX }}
    />
  )
}
