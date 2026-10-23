'use client'

import { useEffect } from 'react'

/**
 * Restores reveal-on-scroll for <AnimateIn> / <StaggerContainer> content that
 * starts below the fold. Mounted once in the root layout; renders nothing.
 *
 * Reveals play a CSS entrance as soon as they render, which is what keeps
 * above-the-fold content (and the page's LCP) independent of JavaScript. For a
 * reveal that is entirely below the viewport this marks it `pending` (hidden,
 * animation parked) and clears the mark when it scrolls into view, which
 * restarts the CSS animation from its first keyframe. Content the reader cannot
 * see yet is the only content ever hidden, so nothing visibly flickers, and if
 * this script never runs everything simply stays visible.
 *
 * New reveals arriving through client-side navigation or streaming are picked
 * up by a MutationObserver.
 */

const BOTTOM_MARGIN = 40 // px; matches framer's former `margin: '-40px'`

export function RevealOnScroll() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const reveal = (target: Element) => {
      // Groups release all of their items together; their CSS delays stagger them.
      const items = target.hasAttribute('data-reveal-group')
        ? target.querySelectorAll(':scope > [data-reveal-item]')
        : [target]
      items.forEach((el) => el.removeAttribute('data-reveal-state'))
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.unobserve(entry.target)
          reveal(entry.target)
        }
      },
      { rootMargin: `0px 0px -${BOTTOM_MARGIN}px 0px` },
    )

    const park = (root: ParentNode) => {
      const viewportBottom = window.innerHeight - BOTTOM_MARGIN
      const candidates = root.querySelectorAll<HTMLElement>('.consilium-reveal:not([data-reveal-item]), [data-reveal-group]')
      candidates.forEach((el) => {
        if (el.dataset.revealWatched) return
        el.dataset.revealWatched = ''
        // Anything already (even partly) on screen keeps its load-time entrance.
        if (el.getBoundingClientRect().top < viewportBottom) return
        const targets = el.hasAttribute('data-reveal-group')
          ? el.querySelectorAll<HTMLElement>(':scope > [data-reveal-item]')
          : [el]
        targets.forEach((t) => t.setAttribute('data-reveal-state', 'pending'))
        io.observe(el)
      })
    }

    park(document)

    const mo = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return
          if (node.matches('.consilium-reveal, [data-reveal-group]')) park(node.parentElement ?? document)
          else if (node.querySelector('.consilium-reveal, [data-reveal-group]')) park(node)
        })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, [])

  return null
}
