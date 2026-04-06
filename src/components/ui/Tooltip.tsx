'use client'

import { useState, useRef, useId, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const id = useId()

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const scrollY = window.scrollY
    const scrollX = window.scrollX
    let top = 0, left = 0

    switch (side) {
      case 'top':
        top = rect.top + scrollY - 8
        left = rect.left + scrollX + rect.width / 2
        break
      case 'bottom':
        top = rect.bottom + scrollY + 8
        left = rect.left + scrollX + rect.width / 2
        break
      case 'left':
        top = rect.top + scrollY + rect.height / 2
        left = rect.left + scrollX - 8
        break
      case 'right':
        top = rect.top + scrollY + rect.height / 2
        left = rect.right + scrollX + 8
        break
    }
    setPos({ top, left })
  }, [side])

  const show = () => {
    calcPos()
    timer.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  // Transform based on side: tooltip appears FROM the trigger edge
  const transform: Record<string, string> = {
    top:    'translateX(-50%) translateY(-100%)',
    bottom: 'translateX(-50%)',
    left:   'translateX(-100%) translateY(-50%)',
    right:  'translateY(-50%)',
  }

  const tooltipEl = visible ? (
    <motion.div
      id={id}
      role="tooltip"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        transform: transform[side],
        maxWidth,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <span className={`block text-xs px-3 py-2 leading-snug text-center whitespace-normal ${variantClass[variant]}`}>
        {content}
      </span>
    </motion.div>
  ) : null

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex items-center ${className ?? ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? id : undefined}
    >
      {children}

      <AnimatePresence>
        {visible && typeof document !== 'undefined'
          ? createPortal(tooltipEl, document.body)
          : null}
      </AnimatePresence>
    </span>
  )
}
