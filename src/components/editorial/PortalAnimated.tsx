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

// The server cannot know the visitor's motion preference, so it always renders the animated version, whose
// inline style starts at opacity 0. A reduced-motion browser then hydrates the plain <div> below, and React does
// not remove the server's inline style, so the page body stayed invisible. `consilium-reveal` (globals.css) forces
// it visible under prefers-reduced-motion; it must be on the server-rendered element, hence on both branches.
const reveal = (className?: string) => `consilium-reveal ${className ?? ''}`

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
    return <div className={reveal(className)}>{children}</div>
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className={reveal(className)}
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
    return <div className={reveal(className)}>{children}</div>
  }

  return (
    <motion.div variants={itemVariants} className={reveal(className)}>
      {children}
    </motion.div>
  )
}
