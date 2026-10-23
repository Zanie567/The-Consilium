import type { CSSProperties, ReactNode } from 'react'

/**
 * Entrance animations, driven by CSS rather than JavaScript.
 *
 * These used to be framer-motion components whose server HTML carried
 * `opacity: 0` until the client bundle downloaded, hydrated and started the
 * animation. Page headings, article headlines and the homepage hero therefore
 * stayed invisible on a slow phone until JavaScript ran, which is what delayed
 * Largest Contentful Paint across the site.
 *
 * Now the markup renders on the server with a CSS keyframe animation that
 * starts at first paint, so content appears without waiting for any script and
 * still appears if scripts never load. The look is unchanged: the same
 * variants, durations, delays and easing.
 *
 * Reveal-on-scroll for content below the fold is kept by <RevealOnScroll />
 * (mounted once in the root layout): after hydration it parks off-screen
 * reveals and replays their animation when they scroll into view, the way
 * framer's `whileInView` + `once` did. Reduced motion shows everything at once
 * (globals.css).
 */

type AnimVariant = 'fade-up' | 'fade-in' | 'fade-left' | 'fade-right' | 'scale-in'

interface AnimateInProps {
  children: ReactNode
  variant?: AnimVariant
  /** Seconds before the entrance starts. */
  delay?: number
  /** Seconds the entrance takes. */
  duration?: number
  className?: string
  /** Kept for API compatibility; reveals always play once. */
  once?: boolean
}

const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ')

export function AnimateIn({ children, variant = 'fade-up', delay = 0, duration = 0.5, className }: AnimateInProps) {
  const style = { '--reveal-delay': `${delay}s`, '--reveal-duration': `${duration}s` } as CSSProperties
  return (
    <div className={cx('consilium-reveal', className)} data-reveal={variant} style={style}>
      {children}
    </div>
  )
}

/**
 * A group whose <StaggerItem> children enter one after another. The group
 * itself does not animate; it decides when its items start.
 */
export function StaggerContainer({
  children,
  className,
  staggerDelay = 0.07,
  delayChildren = 0,
}: {
  children: ReactNode
  className?: string
  /** Seconds between consecutive items. */
  staggerDelay?: number
  /** Seconds before the first item. */
  delayChildren?: number
}) {
  const style = { '--stagger-step': `${staggerDelay}s`, '--stagger-base': `${delayChildren}s` } as CSSProperties
  return (
    <div className={cx('consilium-stagger', className)} data-reveal-group="" style={style}>
      {children}
    </div>
  )
}

/** Direct child of StaggerContainer. */
export function StaggerItem({
  children,
  className,
  variant = 'fade-up',
}: {
  children: ReactNode
  className?: string
  variant?: AnimVariant
}) {
  return (
    <div className={cx('consilium-reveal', className)} data-reveal={variant} data-reveal-item="">
      {children}
    </div>
  )
}
