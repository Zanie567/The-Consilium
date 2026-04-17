'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'

/**
 * Renders today's date in the user's local timezone.
 * Avoids server/client mismatch by rendering nothing on the first paint
 * and then revealing the local date after hydration.
 */
export function ClientDate() {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    setLabel(format(new Date(), 'EEEE, d MMMM yyyy'))
  }, [])

  // Render a non-breaking space as placeholder to preserve height while hydrating
  return <>{label ?? '\u00a0'}</>
}
