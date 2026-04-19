'use client'

import Image from 'next/image'
import { useState } from 'react'
import { useReducedMotion } from 'framer-motion'

interface BlurImageProps {
  src: string
  alt: string
  fill?: boolean
  className?: string
  priority?: boolean
  sizes?: string
}

/**
 * Drop-in replacement for Next.js Image that fades in over 400ms once loaded.
 * Uses a solid dark overlay that fades out on load to mask any white browser
 * loading placeholder. Skipped for reduced-motion users.
 *
 * Note: backdrop-filter was intentionally removed. In WebKit/Safari, a blurred
 * overlay with backdrop-filter can escape the parent's overflow:hidden boundary
 * and produce a white GPU compositing artefact in dark mode. A plain opaque
 * overlay provides the same visual polish without the compositing issues.
 */
export function BlurImage({ src, alt, fill, className = '', priority, sizes }: BlurImageProps) {
  const [loaded, setLoaded] = useState(false)
  const reduced = useReducedMotion()

  return (
    <>
      <Image
        src={src}
        alt={alt}
        fill={fill}
        className={className}
        onLoad={() => setLoaded(true)}
        priority={priority}
        sizes={sizes}
      />
      {/* Solid overlay that fades out once the image has decoded - invisible to
          reduced-motion users. Use a dark navy colour so it blends in both light
          and dark mode without leaving a white flash. */}
      {!reduced && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none bg-navy/30"
          style={{
            opacity: loaded ? 0 : 1,
            transition: 'opacity 0.4s ease-out',
          }}
        />
      )}
    </>
  )
}
