'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { coverImageSource } from '@/lib/coverImageSource'

interface CoverImageProps {
  /** The stored `coverImage` value: an uploaded URL, a pasted address, or nothing. */
  src: string | null | undefined
  alt: string
  /** How wide the picture is drawn, so the browser asks the optimiser for the right size. */
  sizes: string
  /** Shown when there is no cover. Fills the same box as the picture. */
  fallback: ReactNode
  /** Shown when a cover is set but cannot be displayed. Defaults to `fallback`. */
  brokenFallback?: ReactNode
  /** The first picture in view: load at once rather than when scrolled near. */
  eager?: boolean
  className?: string
}

/**
 * A cover image for a list, which always leaves something sensible in its box.
 *
 * The parent supplies the box (`relative`, a fixed aspect ratio, `overflow-hidden`); the picture
 * is cropped to fill it, so every row of a list has the same shape whatever was uploaded.
 *
 * What it handles that a bare <Image> does not:
 *   - no cover, or a value that cannot be an image address: the fallback, with no request made;
 *   - a host the optimiser may not fetch: loaded directly instead of failing with a 400;
 *   - a picture that fails to load (deleted file, blocked host, expired link): the fallback
 *     replaces the browser's broken-image icon.
 */
export function CoverImage({ src, alt, sizes, fallback, brokenFallback, eager = false, className = 'object-cover' }: CoverImageProps) {
  const source = coverImageSource(src)
  const address = source.kind === 'optimised' || source.kind === 'direct' ? source.src : null
  // Remember WHICH address failed, so a row that is given a new cover tries again.
  const [failed, setFailed] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // An image can fail before React attaches onError (it is in the server HTML and the browser
  // starts on it at once). `complete` with no pixels is that case.
  useEffect(() => {
    const img = imgRef.current
    if (address && img?.complete && img.naturalWidth === 0) setFailed(address)
  }, [address])

  if (source.kind === 'none') return <>{fallback}</>
  if (!address || failed === address) return <>{brokenFallback ?? fallback}</>

  return (
    <Image
      ref={imgRef}
      src={address}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      unoptimized={source.kind === 'direct'}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      onError={() => setFailed(address)}
    />
  )
}
