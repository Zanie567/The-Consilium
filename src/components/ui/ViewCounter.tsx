'use client'
import { useEffect } from 'react'
import { ActiveReadingClock } from '@/lib/activeReading'
import { analyticsIdentity } from '@/lib/analyticsIdentity'
export function ViewCounter({ articleId }: { articleId: string }) {
  useEffect(() => {
    const visitId = crypto.randomUUID()
    const clock = new ActiveReadingClock(
      performance.now(),
      document.visibilityState === 'visible',
      document.hasFocus()
    )
    let lastSent = -1
    const send = (beacon = false) => {
      const seconds = clock.tick(performance.now())
      if (seconds === lastSent && !beacon) return
      lastSent = seconds
      const body = JSON.stringify({
        articleId,
        visitId,
        activeSeconds: seconds,
        ...analyticsIdentity(),
        referrer: document.referrer,
      })
      if (
        beacon &&
        navigator.sendBeacon?.(
          '/api/analytics/track',
          new Blob([body], { type: 'application/json' })
        )
      )
        return
      void fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: beacon,
      }).catch(() => {})
    }
    const activity = () => clock.interact(performance.now())
    const visibility = () => {
      clock.visibility(performance.now(), document.visibilityState === 'visible')
      if (document.visibilityState !== 'visible') send(true)
    }
    const focus = () => clock.focus(performance.now(), true)
    const blur = () => {
      clock.focus(performance.now(), false)
      send(true)
    }
    const unload = () => send(true)
    const consent = () => {
      analyticsIdentity()
      lastSent = -1
      send()
    }
    const storage = (event: StorageEvent) => {
      if (event.key === 'consilium_cookie_consent') consent()
    }
    send()
    const interval = setInterval(() => send(), 30000)
    for (const type of ['pointerdown', 'keydown', 'scroll', 'touchstart'])
      window.addEventListener(type, activity, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    window.addEventListener('pagehide', unload)
    window.addEventListener('consilium-consent-change', consent)
    window.addEventListener('storage', storage)
    return () => {
      send(true)
      clearInterval(interval)
      for (const type of ['pointerdown', 'keydown', 'scroll', 'touchstart'])
        window.removeEventListener(type, activity)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pagehide', unload)
      window.removeEventListener('consilium-consent-change', consent)
      window.removeEventListener('storage', storage)
    }
  }, [articleId])
  return null
}
