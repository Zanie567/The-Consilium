'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

const supported = () => typeof window.matchMedia === 'function'

function subscribe(onChange: () => void) {
  if (!supported()) return () => {}
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/**
 * Whether the reader asks for reduced motion. False during server rendering and
 * hydration (matching framer-motion's useReducedMotion, which it replaces), then
 * the live preference, updated if it changes.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => supported() && window.matchMedia(QUERY).matches,
    () => false,
  )
}
