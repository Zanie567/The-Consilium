'use client'

import { useEffect, useRef, useCallback } from 'react'

export function ScrollIndicator() {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartScroll = useRef(0)

  // ── Calculate thumb metrics ─────────────────────────────────────────────
  const getMetrics = useCallback(() => {
    const track = trackRef.current
    if (!track) return null
    const trackH = track.clientHeight
    const docH = document.documentElement.scrollHeight
    const viewH = window.innerHeight
    const maxScroll = docH - viewH
    // Thumb height: proportional to viewport/doc, clamped 44–40% of track
    const thumbH = Math.max(44, Math.min(trackH * 0.4, (viewH / docH) * trackH))
    const maxThumbTop = trackH - thumbH
    const thumbTop = maxScroll > 0 ? (window.scrollY / maxScroll) * maxThumbTop : 0
    return { thumbH, thumbTop, maxThumbTop, maxScroll }
  }, [])

  // ── Update thumb position directly on the DOM (no React re-render) ──────
  const updateThumb = useCallback(() => {
    rafRef.current = null
    const m = getMetrics()
    const thumb = thumbRef.current
    if (!m || !thumb) return
    thumb.style.top = `${m.thumbTop}px`
    thumb.style.height = `${m.thumbH}px`
  }, [getMetrics])

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(updateThumb)
  }, [updateThumb])

  useEffect(() => {
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate, { passive: true })
    updateThumb()
    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [scheduleUpdate, updateThumb])

  // ── Track click: jump to position ───────────────────────────────────────
  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging.current || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const m = getMetrics()
    if (!m) return
    const clickY = e.clientY - rect.top
    const ratio = Math.max(0, Math.min(1, (clickY - m.thumbH / 2) / m.maxThumbTop))
    window.scrollTo({ top: ratio * m.maxScroll, behavior: 'smooth' })
  }, [getMetrics])

  // ── Thumb drag ───────────────────────────────────────────────────────────
  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDragging.current = true
    dragStartY.current = e.clientY
    dragStartScroll.current = window.scrollY
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      const m = getMetrics()
      if (!m) return
      const dy = ev.clientY - dragStartY.current
      const ratio = m.maxThumbTop > 0 ? dy / m.maxThumbTop : 0
      const newScroll = Math.max(0, Math.min(m.maxScroll, dragStartScroll.current + ratio * m.maxScroll))
      window.scrollTo({ top: newScroll, behavior: 'instant' as ScrollBehavior })
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [getMetrics])

  return (
    <div
      ref={trackRef}
      className="fixed right-0 top-0 bottom-0 z-[60] w-[10px] cursor-pointer select-none"
      onClick={handleTrackClick}
      aria-hidden="true"
    >
      {/* Track background */}
      <div className="absolute inset-0 bg-gold/[0.07]" />
      {/* Thumb — position updated directly via ref, no re-renders */}
      <div
        ref={thumbRef}
        className="absolute left-[2px] right-[2px] rounded-full bg-gold/50 hover:bg-gold/80 transition-colors duration-150 cursor-grab active:cursor-grabbing"
        style={{ top: 0, height: 60 }}
        onMouseDown={handleThumbMouseDown}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
