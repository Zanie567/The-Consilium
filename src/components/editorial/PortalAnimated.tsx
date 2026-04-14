'use client'

/**
 * Lightweight animation primitives for editorial portal pages.
 * Mirrors the stagger pattern used on the Analytics dashboard.
 *
 * Usage:
 *   <PortalPage className="p-6 lg:p-8 max-w-4xl">
 *     <PortalSection className="mb-8">...</PortalSection>
 *     <PortalSection>...</PortalSection>
 *   </PortalPage>
 */

import { motion, useReducedMotion } from 'framer-motion'
import { ReactNode } from 'react'

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: 'easeOut' as const } },
}

export function PortalPage({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()

  if (reduced) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function PortalSection({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()

  if (reduced) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  )
}
