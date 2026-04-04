'use client'

import { motion, useReducedMotion, Variants } from 'framer-motion'
import { ReactNode } from 'react'

type AnimVariant = 'fade-up' | 'fade-in' | 'fade-left' | 'fade-right' | 'scale-in'

const variantMap: Record<AnimVariant, Variants> = {
  'fade-up':    { hidden: { opacity: 0, y: 28 },    visible: { opacity: 1, y: 0 } },
  'fade-in':    { hidden: { opacity: 0 },            visible: { opacity: 1 } },
  'fade-left':  { hidden: { opacity: 0, x: -28 },   visible: { opacity: 1, x: 0 } },
  'fade-right': { hidden: { opacity: 0, x: 28 },    visible: { opacity: 1, x: 0 } },
  'scale-in':   { hidden: { opacity: 0, scale: 0.94 }, visible: { opacity: 1, scale: 1 } },
}

const ease = [0.22, 1, 0.36, 1] as const

interface AnimateInProps {
  children: ReactNode
  variant?: AnimVariant
  delay?: number
  duration?: number
  className?: string
  once?: boolean
}

export function AnimateIn({
  children,
  variant = 'fade-up',
  delay = 0,
  duration = 0.55,
  className,
  once = true,
}: AnimateInProps) {
  const prefersReducedMotion = useReducedMotion()

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '-40px' }}
      variants={variantMap[variant]}
      transition={{ duration, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// Staggered container — children should be <StaggerItem>
export function StaggerContainer({
  children,
  className,
  staggerDelay = 0.07,
  delayChildren = 0,
}: {
  children: ReactNode
  className?: string
  staggerDelay?: number
  delayChildren?: number
}) {
  const prefersReducedMotion = useReducedMotion()

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: staggerDelay, delayChildren },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// Direct child of StaggerContainer
export function StaggerItem({
  children,
  className,
  variant = 'fade-up',
}: {
  children: ReactNode
  className?: string
  variant?: AnimVariant
}) {
  const prefersReducedMotion = useReducedMotion()

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      variants={variantMap[variant]}
      transition={{ duration: 0.5, ease }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
