'use client'

import { useEffect } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

export function ScrollIndicator() {
  const rawProgress = useMotionValue(0)
  const scaleY = useSpring(rawProgress, { stiffness: 200, damping: 35, restDelta: 0.001 })

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
    <div
      className="fixed right-0 top-0 bottom-0 z-[60] w-[3px] pointer-events-none"
      aria-hidden="true"
    >
      {/* Track */}
      <div className="absolute inset-0 bg-gold/10" />
      {/* Filled progress */}
      <motion.div
        className="absolute top-0 left-0 right-0 bg-gold origin-top"
        style={{ scaleY, height: '100%' }}
      />
    </div>
  )
}
