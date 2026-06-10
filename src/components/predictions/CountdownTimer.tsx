'use client'

import { useEffect, useState } from 'react'

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Closed'
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${seconds}s`
}

/**
 * Ticking countdown to a deadline. Renders nothing until mounted so the
 * server and client markup never disagree.
 */
export function CountdownTimer({ deadline }: { deadline: string }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (now === null) {
    return <span className="tabular-nums">&nbsp;</span>
  }

  const remaining = new Date(deadline).getTime() - now
  return (
    <span className="tabular-nums" suppressHydrationWarning>
      {formatRemaining(remaining)}
    </span>
  )
}
