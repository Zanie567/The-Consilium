'use client'

import { useState, useRef, useId } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface TooltipProps {
  content: string
  children: React.ReactNode
  /** 'dark' = public site (dark bg, white text); 'editorial' = dashboard (navy bg, gold text) */
  variant?: 'dark' | 'editorial'
  delay?: number
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  maxWidth?: number
}

const sideClass = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
}

const variantClass = {
  dark:       'bg-gray-900 text-white border border-gray-700/60 shadow-xl',
  editorial:  'bg-navy text-gold border border-gold/25 shadow-xl',
}

export function Tooltip({
  content,
  children,
  variant = 'dark',
  delay = 300,
  side = 'top',
  className,
  maxWidth = 260,
}: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  const show = () => {
    timer.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    <span
      className={`relative inline-flex items-center ${className ?? ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? id : undefined}
    >
      {children}

      <AnimatePresence>
        {visible && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, scale: 0.94, y: side === 'top' ? 4 : side === 'bottom' ? -4 : 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className={`absolute z-[300] ${sideClass[side]} pointer-events-none`}
            style={{ maxWidth }}
          >
            <span className={`block text-xs px-3 py-2 leading-snug text-center ${variantClass[variant]}`}>
              {content}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
