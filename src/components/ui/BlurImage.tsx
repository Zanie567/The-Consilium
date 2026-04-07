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
 * Uses an overlay div approach so the underlying <img> CSS is untouched,
 * avoiding conflicts with .img-zoom and global transition rules.
 * Skipped entirely for reduced-motion users.
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
      {/* Frosted overlay that fades out on load — invisible to reduced-motion users */}
      {!reduced && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backdropFilter: loaded ? 'none' : 'blur(6px)',
            backgroundColor: loaded ? 'transparent' : 'rgba(26,39,68,0.12)',
            opacity: loaded ? 0 : 1,
            transition: 'opacity 0.4s ease-out, backdrop-filter 0.4s ease-out, background-color 0.4s ease-out',
          }}
        />
      )}
    </>
  )
}
