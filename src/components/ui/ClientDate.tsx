'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'

function getLabel() {
  return format(new Date(), 'EEEE, d MMMM yyyy')
}

/**
 * Returns milliseconds until the next local midnight.
 * JavaScript computes this in the browser's local timezone, so it is
 * automatically correct across DST transitions (spring-forward / fall-back)
 * in any country — the engine adjusts the wall-clock offset for you.
 */
function msUntilLocalMidnight() {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0) // "tomorrow at 00:00:00.000" in local time
  return midnight.getTime() - now.getTime()
}

/**
 * Renders today's date in the user's local timezone.
 *
 * Handles three cases correctly:
 *  1. Normal midnight rollover — a self-rescheduling timer fires at each
 *     local midnight and updates the label.
 *  2. DST spring-forward / fall-back — `setHours(24, 0, 0, 0)` uses
 *     local-time arithmetic, so the timer fires at the correct wall-clock
 *     midnight even on the night clocks change.
 *  3. Tab hidden during a DST event — a `visibilitychange` listener
 *     refreshes the label the moment the user returns to the tab.
 */
export function ClientDate() {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    setLabel(getLabel())

    // Schedule a refresh at every local midnight (self-rescheduling)
    let timer: ReturnType<typeof setTimeout>
    function scheduleNextMidnight() {
      timer = setTimeout(() => {
        setLabel(getLabel())
        scheduleNextMidnight() // reschedule for the *following* midnight
      }, msUntilLocalMidnight())
    }
    scheduleNextMidnight()

    // Re-check when the tab becomes visible (covers DST changes while hidden)
    function onVisibilityChange() {
      if (!document.hidden) setLabel(getLabel())
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  // Non-breaking space preserves line height while hydrating
  return <>{label ?? '\u00a0'}</>
}
