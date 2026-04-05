'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export function ScrollIndicator() {
  const trackRef = useRef<HTMLDivElement>(null)
  const [thumbTop, setThumbTop] = useState(0)
  const [thumbHeight, setThumbHeight] = useState(60)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartScroll = useRef(0)

  const getThumbMetrics = useCallback(() => {
    if (!trackRef.current) return { th: 60, maxThumbTop: 0 }
    const trackHeight = trackRef.current.clientHeight
    const docHeight = document.documentElement.scrollHeight
    const viewHeight = window.innerHeight
    const th = Math.max(44, Math.min(trackHeight * 0.4, (viewHeight / docHeight) * trackHeight))
    return { th, maxThumbTop: trackHeight - th }
  }, [])

  const update = useCallback(() => {
    if (!trackRef.current) return
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    const { th, maxThumbTop } = getThumbMetrics()
    const tt = maxScroll > 0 ? (window.scrollY / maxScroll) * maxThumbTop : 0
    setThumbHeight(th)
    setThumbTop(tt)
  }, [getThumbMetrics])

  useEffect(() => {
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [update])

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging.current || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const { th, maxThumbTop } = getThumbMetrics()
    const clickY = e.clientY - rect.top
    const ratio = Math.max(0, Math.min(1, (clickY - th / 2) / maxThumbTop))
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo({ top: ratio * maxScroll, behavior: 'smooth' })
  }

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDragging.current = true
    dragStartY.current = e.clientY
    dragStartScroll.current = window.scrollY

    const onMouseMove = (ev: MouseEvent) => {
      if (!trackRef.current) return
      const { th, maxThumbTop } = getThumbMetrics()
      const dy = ev.clientY - dragStartY.current
      const ratio = maxThumbTop > 0 ? dy / maxThumbTop : 0
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo({ top: dragStartScroll.current + ratio * maxScroll })
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      ref={trackRef}
      className="fixed right-0 top-0 bottom-0 z-[60] w-[10px] cursor-pointer select-none"
      onClick={handleTrackClick}
      aria-hidden="true"
    >
      {/* Track */}
      <div className="absolute inset-0 bg-gold/[0.08]" />
      {/* Thumb */}
      <div
        className="absolute left-[2px] right-[2px] rounded-full bg-gold/50 hover:bg-gold/80 transition-colors duration-150 cursor-grab active:cursor-grabbing"
        style={{ top: thumbTop, height: thumbHeight }}
        onMouseDown={handleThumbMouseDown}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
