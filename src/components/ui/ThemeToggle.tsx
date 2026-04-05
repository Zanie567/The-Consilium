'use client'

import { useTheme } from 'next-themes'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="w-8 h-8" aria-hidden />
  }

  const isDark = theme === 'dark'

  return (
    <Tooltip content={isDark ? 'Switch to light mode' : 'Switch to dark mode'} side="bottom">
    <motion.button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="relative w-8 h-8 flex items-center justify-center text-cream/60 hover:text-gold transition-colors duration-200 rounded-sm"
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.88 }}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? 'sun' : 'moon'}
          initial={{ rotate: -60, opacity: 0, scale: 0.7 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 60, opacity: 0, scale: 0.7 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
    </Tooltip>
  )
}
